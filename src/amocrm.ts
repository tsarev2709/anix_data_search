import type { Config } from "./config.js";
import type { CompanyContext, ContactCandidate } from "./types.js";
import { requestJson, type HttpOptions } from "./http.js";
import { normalizeEmail, normalizePhone, normalizeUrl, truncate } from "./utils.js";

interface AmoFieldValue {
  field_id: number;
  field_name?: string;
  field_code?: string | null;
  field_type?: string;
  values: Array<{ value: unknown; enum_code?: string | null }>;
}

interface AmoLead {
  id: number;
  name: string;
  pipeline_id: number;
  status_id: number;
  responsible_user_id: number;
  _embedded?: {
    companies?: Array<{ id: number; name?: string }>;
    contacts?: Array<{ id: number; is_main?: boolean }>;
  };
}

interface AmoCompany {
  id: number;
  name: string;
  custom_fields_values?: AmoFieldValue[] | null;
}

interface AmoContact {
  id: number;
  name: string;
  custom_fields_values?: AmoFieldValue[] | null;
}

interface Collection<T> {
  _embedded?: Record<string, T[]>;
}

function fieldValues(entity: { custom_fields_values?: AmoFieldValue[] | null }, predicate: (field: AmoFieldValue) => boolean): string[] {
  return (entity.custom_fields_values ?? [])
    .filter(predicate)
    .flatMap((field) => field.values)
    .map((value) => String(value.value ?? "").trim())
    .filter(Boolean);
}

function websiteFromCompany(company: AmoCompany, configuredFieldId?: number): string | null {
  const values = fieldValues(
    company,
    (field) =>
      (configuredFieldId !== undefined && field.field_id === configuredFieldId) ||
      field.field_code === "WEB" ||
      field.field_type === "url" ||
      /сайт|website|web/i.test(field.field_name ?? ""),
  );
  return values.map(normalizeUrl).find((value): value is string => Boolean(value)) ?? null;
}

export class AmoCRMClient {
  private readonly http: HttpOptions;

  constructor(
    private readonly config: Config["amo"],
    http: HttpOptions,
  ) {
    this.http = http;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.config.accessToken}`);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    return requestJson<T>(`${this.config.baseUrl}${path}`, { ...init, headers }, this.http);
  }

  async listSourceCompanies(limit: number): Promise<CompanyContext[]> {
    const query = new URLSearchParams();
    query.set("with", "companies,contacts");
    query.set("limit", String(limit));
    query.set("order[id]", "asc");
    query.set("filter[statuses][0][pipeline_id]", String(this.config.pipelineId));
    query.set("filter[statuses][0][status_id]", String(this.config.sourceStatusId));
    const response = await this.request<Collection<AmoLead>>(`/api/v4/leads?${query.toString()}`);
    const leads = response._embedded?.leads ?? [];

    return Promise.all(
      leads.map(async (lead) => {
        const companyLink = lead._embedded?.companies?.[0];
        const company = companyLink ? await this.getCompany(companyLink.id) : null;
        return {
          sourceLeadId: lead.id,
          sourceLeadName: lead.name,
          pipelineId: lead.pipeline_id,
          statusId: lead.status_id,
          responsibleUserId: lead.responsible_user_id || null,
          companyId: company?.id ?? companyLink?.id ?? null,
          companyName: company?.name || companyLink?.name || lead.name,
          website: company ? websiteFromCompany(company, this.config.companyWebsiteFieldId) : null,
          linkedContactIds: (lead._embedded?.contacts ?? []).map((contact) => contact.id),
        };
      }),
    );
  }

  async getCompany(id: number): Promise<AmoCompany> {
    return this.request<AmoCompany>(`/api/v4/companies/${id}`);
  }

  async findContact(candidate: ContactCandidate): Promise<AmoContact | null> {
    const queryValue = candidate.emails[0]?.value ?? candidate.phones[0];
    if (!queryValue) return null;
    const query = new URLSearchParams({ query: queryValue, limit: "50" });
    const response = await this.request<Collection<AmoContact>>(`/api/v4/contacts?${query.toString()}`);
    const contacts = response._embedded?.contacts ?? [];
    const wantedEmails = new Set(candidate.emails.map((email) => normalizeEmail(email.value)));
    const wantedPhones = new Set(candidate.phones.map(normalizePhone));
    return (
      contacts.find((contact) => {
        const emails = fieldValues(contact, (field) => field.field_code === "EMAIL").map(normalizeEmail);
        const phones = fieldValues(contact, (field) => field.field_code === "PHONE").map(normalizePhone);
        return emails.some((email) => wantedEmails.has(email)) || phones.some((phone) => wantedPhones.has(phone));
      }) ?? null
    );
  }

  async createContact(company: CompanyContext, candidate: ContactCandidate): Promise<AmoContact> {
    const customFields: Array<Record<string, unknown>> = [];
    if (candidate.emails.length > 0) {
      customFields.push({ field_code: "EMAIL", values: candidate.emails.map((email) => ({ value: email.value, enum_code: "WORK" })) });
    }
    if (candidate.phones.length > 0) {
      customFields.push({ field_code: "PHONE", values: candidate.phones.map((phone) => ({ value: phone, enum_code: "WORK" })) });
    }
    if (candidate.position && this.config.contactPositionFieldId) {
      customFields.push({ field_id: this.config.contactPositionFieldId, values: [{ value: candidate.position }] });
    }
    const name = candidate.fullName || (candidate.emails.some((email) => email.generic) ? `Общий контакт — ${company.companyName}` : `Контакт — ${company.companyName}`);
    const body: Record<string, unknown> = { name, custom_fields_values: customFields };
    if (company.responsibleUserId) body.responsible_user_id = company.responsibleUserId;
    if (company.companyId) body._embedded = { companies: [{ id: company.companyId }] };
    const response = await this.request<Collection<AmoContact>>("/api/v4/contacts", { method: "POST", body: JSON.stringify([body]) });
    const contact = response._embedded?.contacts?.[0];
    if (!contact) throw new Error("amoCRM did not return the created contact");
    return contact;
  }

  async linkContactToLead(leadId: number, contactId: number): Promise<void> {
    await this.request(`/api/v4/leads/${leadId}/link`, {
      method: "POST",
      body: JSON.stringify([{ to_entity_id: contactId, to_entity_type: "contacts" }]),
    });
  }

  async createLead(company: CompanyContext, candidate: ContactCandidate, contactId: number): Promise<number> {
    if (!this.config.outputPipelineId || !this.config.outputStatusId) throw new Error("Output pipeline/status is not configured");
    const label = candidate.fullName || candidate.emails[0]?.value || candidate.phones[0] || "контакт";
    const embedded: Record<string, Array<{ id: number }>> = { contacts: [{ id: contactId }] };
    if (company.companyId) embedded.companies = [{ id: company.companyId }];
    const body: Record<string, unknown> = {
      name: `${company.companyName} — ${label}`,
      pipeline_id: this.config.outputPipelineId,
      status_id: this.config.outputStatusId,
      _embedded: embedded,
    };
    if (company.responsibleUserId) body.responsible_user_id = company.responsibleUserId;
    const response = await this.request<Collection<AmoLead>>("/api/v4/leads", { method: "POST", body: JSON.stringify([body]) });
    const lead = response._embedded?.leads?.[0];
    if (!lead) throw new Error("amoCRM did not return the created lead");
    return lead.id;
  }

  async addNote(leadId: number, text: string): Promise<void> {
    await this.request(`/api/v4/leads/${leadId}/notes`, {
      method: "POST",
      body: JSON.stringify([{ note_type: "common", params: { text: truncate(text, 10_000) } }]),
    });
  }

  async createFollowUpTask(leadId: number, responsibleUserId: number | null, days: number): Promise<void> {
    const completeTill = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    const body: Record<string, unknown> = {
      entity_id: leadId,
      entity_type: "leads",
      task_type_id: 1,
      complete_till: completeTill,
      text: "Проверить найденные контакты и сделать персональное касание",
    };
    if (responsibleUserId) body.responsible_user_id = responsibleUserId;
    await this.request("/api/v4/tasks", { method: "POST", body: JSON.stringify([body]) });
  }

  async moveLead(leadId: number, statusId: number): Promise<void> {
    await this.request(`/api/v4/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ status_id: statusId }) });
  }
}
