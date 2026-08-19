import type { Config } from "./config.js";
import type { CompanyContext, ContactCandidate, SyncAction } from "./types.js";
import { AmoCRMClient } from "./amocrm.js";
import { truncate } from "./utils.js";

function candidateLabel(candidate: ContactCandidate): string {
  return candidate.fullName || candidate.emails[0]?.value || candidate.phones[0] || candidate.socialUrls[0] || "безымянный контакт";
}

function crmSafeCandidate(candidate: ContactCandidate): ContactCandidate {
  return { ...candidate, emails: candidate.emails.filter((email) => email.status !== "inferred") };
}

function noteText(company: CompanyContext, candidate: ContactCandidate, runId: string): string {
  const channels = [
    ...candidate.emails.map((email) => `${email.value} (${email.status ?? (email.generic ? "general" : "found")}, ${email.deliverability}${email.confidence ? `, ${email.confidence}%` : ""})`),
    ...candidate.phones,
    ...candidate.socialUrls,
  ];
  const sources = [...new Set(candidate.evidence.map((item) => item.url))];
  return truncate(
    [
      `[anix-data-search:${runId}]`,
      `Компания: ${company.companyName}`,
      `Контакт: ${candidateLabel(candidate)}`,
      candidate.position ? `Должность: ${candidate.position}` : "",
      `Оценка: ${candidate.score}/100`,
      `Каналы: ${channels.join(", ")}`,
      `Основания: ${candidate.scoreReasons.join("; ")}`,
      `Источники:\n${sources.map((source) => `- ${source}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    9_500,
  );
}

async function perform(
  actions: SyncAction[],
  type: SyncAction["type"],
  detail: string,
  apply: boolean,
  operation?: () => Promise<void>,
): Promise<void> {
  const action: SyncAction = { type, status: apply ? "completed" : "planned", detail };
  actions.push(action);
  if (!apply || !operation) return;
  try {
    await operation();
  } catch (error) {
    action.status = "failed";
    action.detail = `${detail}: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}

export async function syncCandidates(
  amo: AmoCRMClient,
  config: Config,
  company: CompanyContext,
  candidates: ContactCandidate[],
  runId: string,
): Promise<SyncAction[]> {
  const actions: SyncAction[] = [];
  const apply = config.run.mode === "apply";
  let allSucceeded = true;

  for (const candidate of candidates) {
    try {
      const writable = crmSafeCandidate(candidate);
      const existing = await amo.findContact(writable);
      let contactId = existing?.id ?? null;
      if (existing) {
        await perform(actions, "reuse_contact", `${candidateLabel(candidate)} → контакт #${existing.id}`, apply);
      } else {
        await perform(actions, "create_contact", candidateLabel(candidate), apply, async () => {
          const created = await amo.createContact(company, writable);
          contactId = created.id;
        });
      }

      if (config.amo.writeMode === "enrich") {
        if (contactId && company.linkedContactIds.includes(contactId)) {
          actions.push({ type: "skip", status: "skipped", detail: `Контакт #${contactId} уже привязан к сделке #${company.sourceLeadId}` });
        } else {
          await perform(
            actions,
            "link_contact",
            `${candidateLabel(candidate)} → исходная сделка #${company.sourceLeadId}`,
            apply,
            contactId ? () => amo.linkContactToLead(company.sourceLeadId, contactId as number) : undefined,
          );
        }
        await perform(
          actions,
          "create_note",
          `Источник и скоринг для ${candidateLabel(candidate)}`,
          apply,
          () => amo.addNote(company.sourceLeadId, noteText(company, candidate, runId)),
        );
      } else {
        let newLeadId: number | null = null;
        await perform(
          actions,
          "create_lead",
          `${company.companyName} — ${candidateLabel(candidate)}`,
          apply,
          contactId
            ? async () => {
                newLeadId = await amo.createLead(company, candidate, contactId as number);
              }
            : undefined,
        );
        if (apply && newLeadId) {
          await perform(actions, "create_note", `Источники → новая сделка #${newLeadId}`, true, () =>
            amo.addNote(newLeadId as number, noteText(company, candidate, runId)),
          );
        } else if (!apply) {
          await perform(actions, "create_note", `Источники → планируемая новая сделка`, false);
        }
      }
    } catch {
      allSucceeded = false;
    }
  }

  if (candidates.length > 0 && config.run.createFollowUpTask) {
    await perform(
      actions,
      "create_task",
      `Задача через ${config.run.followUpDays} дн. в исходной сделке #${company.sourceLeadId}`,
      apply,
      () => amo.createFollowUpTask(company.sourceLeadId, company.responsibleUserId, config.run.followUpDays),
    ).catch(() => {
      allSucceeded = false;
    });
  }

  if (candidates.length > 0 && allSucceeded && config.amo.successStatusId) {
    await perform(
      actions,
      "move_source_lead",
      `Сделка #${company.sourceLeadId} → статус #${config.amo.successStatusId}`,
      apply,
      () => amo.moveLead(company.sourceLeadId, config.amo.successStatusId as number),
    ).catch(() => undefined);
  }

  if (candidates.length === 0) actions.push({ type: "skip", status: "skipped", detail: "Подходящих контактов не найдено" });
  return actions;
}
