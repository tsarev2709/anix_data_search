import { afterEach, describe, expect, it, vi } from "vitest";
import { companyInnFromFields } from "../src/amocrm.js";
import { officialCompanyInn, validInn } from "../src/procurement/identity.js";
import { linkCases, parsePublicRecord, procurementQueries, publicRecordUrl, researchProcurement, summarizeProcurement } from "../src/procurement/research.js";
import { renderProcurementMarkdown } from "../src/procurement/report.js";
import { loadConfig } from "../src/config.js";
import type { CompanyContext, SearchResult } from "../src/types.js";
import type { MultiSearchOutcome } from "../src/providers/multi-search.js";

const company: CompanyContext = { companyName: "Тестовая компания", inn: "7707083893", website: null, companyId: null, sourceLeadId: 1, sourceLeadName: "test", pipelineId: 1, statusId: 1, responsibleUserId: null, linkedContactIds: [], source: "manual" };
const tender: SearchResult = { title: "Закупка анимационного видеоролика", url: "https://zakupki.gov.ru/epz/order/notice/ea44/view/common-info.html?regNumber=0123456789012345678", content: "Тестовая компания" };
const caseResult: SearchResult = { title: "Дело А40-12345/2026", url: "https://kad.arbitr.ru/Card/test-case", content: "Тестовая компания" };
const card = (body = "") => `<html><body><main><h1>Закупка анимационного видеоролика</h1><p>Заказчик: ООО «Тестовая компания», ИНН 7707083893</p><p>Статус закупки: Не состоялась</p><p>Предмет закупки: Анимационный ролик по охране труда</p><p>Начальная максимальная цена контракта: 1 200 000 руб.</p><p>Окончание подачи заявок: 14.10.2026 12:00 МСК</p>${body}</main></body></html>`;
const caseCard = (body = "") => `<main><h1>Дело А40-12345/2026</h1><p>Истец: Тестовая компания, ИНН 7707083893</p><p>Статус дела: Завершено</p><p>Предмет спора: Оплата по договору</p><p>Результат рассмотрения: Иск удовлетворён частично</p>${body}</main>`;
const http = { timeoutMs: 1000, retries: 0, userAgent: "test" };
const options = { enabled: true, queryBudget: 16, tavilyQueryBudget: 4, maxPages: 8 };
const outcome = (results: SearchResult[], queries: string[] = []): MultiSearchOutcome => ({ results, queries, providers: { searxng: "used" }, queryCounts: { tavily: 4 }, warnings: [], failures: [] });

afterEach(() => vi.unstubAllGlobals());

describe("company legal identity", () => {
  it("checks INN checksums and does not accept a random ten-digit string", () => {
    expect(validInn("7707083893")).toBe("7707083893");
    expect(validInn("7707083894")).toBeNull();
    expect(validInn("0000000000")).toBeNull();
    expect(validInn("7707 083893")).toBeNull();
  });
  it("reads the designated CRM field and never treats a phone field as INN", () => {
    const entity = { custom_fields_values: [{ field_id: 1, field_name: "Телефон", values: [{ value: "7707083893" }] }, { field_id: 2, field_name: "ИНН", values: [{ value: "7707083893" }] }] };
    expect(companyInnFromFields(entity)).toBe("7707083893");
    expect(companyInnFromFields({ custom_fields_values: entity.custom_fields_values.slice(0, 1) })).toBeNull();
    expect(companyInnFromFields(entity, 100)).toBeNull();
  });
  it("uses the official site's INN only when unique and next to the company name", () => {
    const page = { url: "https://company.example/contacts", text: "ООО Тестовая компания. Реквизиты: ИНН 7707083893" };
    expect(officialCompanyInn([page], company.companyName)).toEqual({ inn: "7707083893", sourceUrl: page.url });
    expect(officialCompanyInn([{ ...page, text: "Разработчик сайта. ИНН 7707083893" }], company.companyName)).toBeNull();
    expect(officialCompanyInn([page, { ...page, text: "Тестовая компания ИНН 7736050003" }], company.companyName)).toBeNull();
  });
  it("searches lifecycle, supplier/customer roles, courts and documents by exact INN", () => {
    const queries = procurementQueries(company);
    expect(queries.every((query) => query.includes('"7707083893"') || query.includes('"Тестовая компания"'))).toBe(true);
    expect(queries.some((query) => query.includes("несостоявшаяся"))).toBe(true);
    expect(queries.some((query) => query.includes("поставщик"))).toBe(true);
    expect(queries.some((query) => query.includes("site:kad.arbitr.ru"))).toBe(true);
    expect(queries.some((query) => query.includes("техническое задание"))).toBe(true);
  });
});

describe("procurement evidence extraction", () => {
  it("extracts roles, lifecycle, financial strings and real specification links", () => {
    const record = parsePublicRecord(card('<a href="/files/tz.docx">Техническое задание</a><a href="/files/protocol.pdf">Протокол итогов</a>'), tender, company)!;
    expect(record).toMatchObject({ verification: "confirmed", role: "customer", status: "failed", identity: "inn", amount: "1 200 000 руб.", number: "0123456789012345678", relevance: "anix" });
    expect(record.documents[0]).toMatchObject({ url: "https://zakupki.gov.ru/files/tz.docx", kind: "specification", sourceUrl: tender.url });
    expect(record.documents[1]?.kind).toBe("protocol");
    expect(summarizeProcurement([record])).toMatchObject({ confirmedProcurements: 1, customer: 1, failed: 1, specificationLinks: 1 });
  });
  it("does not infer lifecycle from menus, generic prose or a failed-search query", () => {
    const html = `<nav>Приём заявок Завершена Не состоялась</nav><main><h1>Закупка</h1><p>Заказчик: Тестовая компания, ИНН 7707083893</p><p>В случае если закупка не состоялась, заказчик вправе повторить процедуру.</p></main>`;
    expect(parsePublicRecord(html, { ...tender, query: "несостоявшаяся закупка" }, company)?.status).toBe("unknown");
  });
  it("keeps name-only and snippet-only matches as candidates", () => {
    expect(parsePublicRecord(card(), tender, { ...company, inn: null })?.verification).toBe("candidate");
    expect(parsePublicRecord(null, { ...tender, content: "Заказчик: Тестовая компания ИНН 7707083893. Статус закупки: завершена" }, company)).toMatchObject({ verification: "candidate", role: "unknown", status: "unknown", fetchedAt: null });
  });
  it("rejects a conflicting legal entity and unrelated third-party pages", () => {
    expect(parsePublicRecord(card().replaceAll("7707083893", "7736050003"), tender, company)).toBeNull();
    expect(parsePublicRecord(card(), { ...tender, url: "https://evil.example/" }, company)).toBeNull();
    expect(publicRecordUrl("https://zakupki.gov.ru.evil.example/tender")).toBeNull();
    expect(publicRecordUrl("https://127.0.0.1/tender")).toBeNull();
    expect(publicRecordUrl("https://user:pass@zakupki.gov.ru/tender")).toBeNull();
  });
  it("ignores unsafe or unrelated links and distinguishes restricted documentation", () => {
    const record = parsePublicRecord(card('<p>Документация от организатора доступна зарегистрированным пользователям.</p><a href="javascript:alert(1)">ТЗ</a><a href="https://evil.example/tz.pdf">ТЗ</a>'), tender, company)!;
    expect(record.documents).toEqual([]);
    expect(record.documentsAccess).toBe("restricted");
  });
  it("retains an indexed direct specification link without claiming its content was read", () => {
    const record = parsePublicRecord(null, { title: "Техническое задание", url: "https://zakupki.gov.ru/files/tz.pdf", content: "Тестовая компания, ИНН 7707083893" }, company)!;
    expect(record.documents[0]?.kind).toBe("specification");
    expect(record.verification).toBe("candidate");
    expect(record.fetchedAt).toBeNull();
  });
  it("does not confirm participation from an INN mention without an identified role", () => {
    const record = parsePublicRecord('<main>Тестовая компания ИНН 7707083893. Закупка № 0123456789012345678. Дополнительные сведения.</main>', tender, company)!;
    expect(record.verification).toBe("candidate");
    expect(summarizeProcurement([record]).confirmedProcurements).toBe(0);
  });
  it("does not assign another legal entity's role when the target INN appears elsewhere", () => {
    const record = parsePublicRecord(card().replace("Заказчик: ООО «Тестовая компания», ИНН 7707083893", "Заказчик: ООО «Тестовая компания», ИНН 7736050003")
      .replace("</main>", "<p>Упоминается иной контрагент ИНН 7707083893.</p></main>"), tender, company)!;
    expect(record.role).toBe("unknown");
    expect(record.verification).toBe("candidate");
  });
  it("only links court cases through a quoted purchase or contract reference", () => {
    const purchase = parsePublicRecord(card(), tender, company)!;
    const unrelated = parsePublicRecord(caseCard(), caseResult, company)!;
    const related = parsePublicRecord(caseCard(`<p>${"Текст. ".repeat(300)} Закупка № 0123456789012345678 — предмет спора.</p>`), { ...caseResult, url: "https://kad.arbitr.ru/Card/related" }, company)!;
    linkCases([purchase, unrelated, related]);
    expect(unrelated.relatedProcurementUrls).toEqual([]);
    expect(related.relatedProcurementUrls).toEqual([tender.url]);
    expect(related.relationEvidence).toContain("предмет спора");
    expect(related.outcome).toBe("Иск удовлетворён частично");
  });
  it("treats a secondary court mirror as a candidate", () => {
    const record = parsePublicRecord(caseCard(), { ...caseResult, url: "https://sudact.ru/arbitral/doc/123" }, company)!;
    expect(record.authority).toBe("secondary");
    expect(record.verification).toBe("candidate");
  });
});

describe("automatic company dossier", () => {
  it("preserves unavailable status and never concludes that there are no tenders", async () => {
    const research = await researchProcurement(company, { searchPublicQueries: async () => { throw new Error("offline"); } }, http, options);
    expect(research.status).toBe("unavailable");
    expect(renderProcurementMarkdown(research).join("\n")).toContain("Ноль не подтверждает отсутствие");
  });
  it("does no network work when disabled", async () => {
    const searchPublicQueries = vi.fn();
    expect((await researchProcurement(company, { searchPublicQueries }, http, { ...options, enabled: false })).status).toBe("disabled");
    expect(searchPublicQueries).not.toHaveBeenCalled();
  });
  it("searches court cases by discovered purchase number and shares the paid query budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new Response(String(input).includes("kad.arbitr") ? caseCard('<p>Закупка № 0123456789012345678 — предмет спора.</p>') : card(), { headers: { "content-type": "text/html" } })));
    const searchPublicQueries = vi.fn(async (queries: string[], paid: number) => outcome(queries.some((query) => query.includes('"0123456789012345678"')) ? [caseResult] : [tender], queries));
    const research = await researchProcurement(company, { searchPublicQueries }, http, options);
    expect(searchPublicQueries).toHaveBeenCalledTimes(2);
    expect(searchPublicQueries.mock.calls[1]![0].some((query) => query.includes('"0123456789012345678"'))).toBe(true);
    expect(searchPublicQueries.mock.calls[1]![1]).toBe(0);
    expect(research.plannedQueries.length).toBeLessThanOrEqual(16);
    expect(research.summary).toMatchObject({ confirmedProcurements: 1, confirmedCases: 1, linkedCases: 1 });
  });
  it("does not follow a redirect to another server and retains the search candidate", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }));
    vi.stubGlobal("fetch", fetch);
    const research = await researchProcurement(company, { searchPublicQueries: async (queries) => outcome([tender], queries) }, http, options);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(research.status).toBe("partial");
    expect(research.records[0]?.verification).toBe("candidate");
    expect(research.warnings.join(" ")).toContain("302");
  });
  it("configures the stage automatically and provides a hard disable switch", () => {
    const env = { AMO_BASE_URL: "https://test.amocrm.ru", AMO_ACCESS_TOKEN: "test", AMO_PIPELINE_ID: "1", AMO_SOURCE_STATUS_ID: "1" };
    expect(loadConfig(env).procurement).toEqual(options);
    expect(loadConfig({ ...env, PROCUREMENT_ENABLED: "false" }).procurement.enabled).toBe(false);
  });
});
