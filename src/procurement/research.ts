import * as cheerio from "cheerio";
import { fetchWithRetry, type HttpOptions } from "../http.js";
import type { CompanyContext, SearchResult } from "../types.js";
import { uniqueBy } from "../utils.js";
import type { MultiSearchOutcome } from "../providers/multi-search.js";
import { normalizedCompanyName, validInn } from "./identity.js";
import type { CompanyPublicRecord, ProcurementDocument, ProcurementResearch } from "./types.js";

export const PROCUREMENT_SITES = ["zakupki.gov.ru", "b2b-center.ru", "fabrikant.ru", "roseltorg.ru", "tender.pro", "tektorg.ru", "etp.gpb.ru"];
const COURT_SITES = ["kad.arbitr.ru", "ras.arbitr.ru", "sudact.ru"];
const ANIX = /видеоролик|видеофильм|видеоконтент|анимац|мультипликац|моушн|инструктаж|охрана труда|охране труда|промышленн[а-яё]* безопасност|обучени[а-яё]* персонала|электронн[а-яё]* курс|медицинск[а-яё]* образован|маскот/i;

export function publicRecordUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (![...PROCUREMENT_SITES, ...COURT_SITES].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function procurementQueries(company: Pick<CompanyContext, "companyName" | "inn">): string[] {
  const name = company.companyName.replace(/["«»“”]/g, " ").trim();
  const inn = validInn(company.inn);
  const target = `"${inn ?? name}"`;
  // Put court, role and lifecycle queries first so even a small budget covers them.
  return uniqueBy([
    `${target} site:zakupki.gov.ru`,
    `${target} site:kad.arbitr.ru`,
    `${target} закупка ("несостоявшаяся" OR "не состоялась")`,
    `${target} ("поставщик" OR "победитель") контракт`,
    `${target} ("заказчик" OR "организатор") тендер`,
    ...PROCUREMENT_SITES.slice(1).map((site) => `${target} site:${site}`),
    `${target} ("завершена" OR "исполнение завершено") закупка`,
    `${target} ("техническое задание" OR "описание объекта закупки")`,
    ...COURT_SITES.slice(1).map((site) => `${target} site:${site}`),
    `${target} (видеоролик OR анимация OR обучение OR "охрана труда") закупка`,
    ...(inn ? [`"${name}" закупки тендеры`] : []),
  ], (query) => query);
}

function compact(value: string): string { return value.replace(/[\t\r ]+/g, " ").replace(/\n\s*\n/g, "\n").trim(); }
function clip(value: string, limit: number): string { return value.replace(/\s+/g, " ").trim().slice(0, limit); }

function field(text: string, label: string): string | null {
  return clip(text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:：]\\s*([^\\n]{1,250})`, "i"))?.[1] ?? "", 250) || null;
}

function recordNumber(url: string, text: string, kind: CompanyPublicRecord["kind"]): string | null {
  if (kind === "arbitration") return text.match(/(?:А|A)\d{1,3}\s*[-–]\s*\d{1,9}\s*\/\s*(?:20)?\d{2}/)?.[0]?.replace(/\s+/g, "").replace(/^A/, "А").replace("–", "-") ?? null;
  const parsed = new URL(url);
  return parsed.searchParams.get("regNumber")?.match(/^\d{11,19}$/)?.[0]
    ?? parsed.pathname.match(/tender[-/](\d{5,19})/)?.[1]
    ?? field(text, "(?:номер|реестровый номер) (?:закупки|извещения)|закупка №|тендер №")?.match(/\d{5,19}/)?.[0]
    ?? text.match(/(?:закупк[аи]|тендер|извещени[ея])\s*(?:№|номер)\s*(\d{5,19})/i)?.[1] ?? null;
}

function hasName(text: string, companyName: string): boolean {
  const wanted = normalizedCompanyName(companyName);
  return wanted.length >= 3 && ` ${normalizedCompanyName(text)} `.includes(` ${wanted} `);
}

function listedInns(text: string): string[] {
  return [...text.matchAll(/(?:^|[^a-zа-яё0-9])(?:ИНН|INN)\s*[:：]?\s*(\d{10,12})(?!\d)/gi)].map((match) => match[1]!);
}

function identify(text: string, company: Pick<CompanyContext, "companyName" | "inn">): CompanyPublicRecord["identity"] {
  const inn = validInn(company.inn);
  const listed = listedInns(text);
  if (inn && listed.includes(inn)) return "inn";
  if (inn && listed.length && !listed.includes(inn)) return "conflict";
  return hasName(text, company.companyName) ? "name" : "unmatched";
}

function extractDocuments($: cheerio.CheerioAPI, pageUrl: string): ProcurementDocument[] {
  return uniqueBy($("a[href]").toArray().flatMap((element) => {
    const node = $(element);
    const title = clip(node.text() || node.attr("title") || "", 200);
    const href = node.attr("href") ?? "";
    const url = publicRecordUrl(href, pageUrl);
    if (!url || !title || /войти|регистрац|тариф|политик|инструкци.*площадк/i.test(title)) return [];
    const specification = /техническ[а-яё]* задан|описание объекта закупки|(?:^|\s)тз(?:\s|[.(_-]|$)/i.test(title);
    const protocol = /протокол|подведени[а-яё]* итог/i.test(title);
    const contract = /(?:проект )?(?:договор|контракт)/i.test(title);
    if (!specification && !protocol && !contract && !/документац/i.test(title)) return [];
    if (!/\.(?:pdf|docx?|xlsx?|zip|rar)(?:[?#]|$)|download|document|attachment|file|документ/i.test(url)) return [];
    return [{ title, url, kind: specification ? "specification" as const : protocol ? "protocol" as const : contract ? "contract" as const : "other" as const, sourceUrl: pageUrl }];
  }), (document) => document.url).slice(0, 30);
}

/** Only labelled fields set lifecycle or roles; navigation mentions are not evidence. */
export function parsePublicRecord(html: string | null, result: SearchResult, company: Pick<CompanyContext, "companyName" | "inn">, now = new Date()): CompanyPublicRecord | null {
  const url = publicRecordUrl(result.url);
  if (!url) return null;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const kind = COURT_SITES.some((site) => host === site || host.endsWith(`.${site}`)) ? "arbitration" : "procurement";
  const authority = host === "sudact.ru" || host.endsWith(".sudact.ru") ? "secondary" : "primary";
  const $ = cheerio.load(html ?? "");
  $("script,style,nav,header,footer,aside,form,.related,.similar,[class*='similar'],[class*='recommend']").remove();
  const scope = $("main, article, #main, #content").first();
  const root = scope.length ? scope : $("body");
  root.find("br").replaceWith("\n");
  root.find("p,div,tr,section,li,h1,h2,h3,h4,dt,dd").append("\n");
  const text = html ? compact(root.text()).slice(0, 120_000) : `${result.title}\n${result.content}`;
  if (html && (/captcha|проверка.*(?:робот|браузер)|доступ ограничен|access denied/i.test(text.slice(0, 1500)) || text.length < 40)) return null;
  const identity = identify(text, company);
  const number = recordNumber(url, text, kind);
  if (identity === "unmatched" || identity === "conflict") return null;
  const directSpecification = !html && /\.(?:pdf|docx?)(?:[?#]|$)/i.test(url)
    && /техническ[а-яё]* задан|описание объекта закупки|(?:^|\s)тз(?:\s|[.(_-]|$)/i.test(result.title);
  const documents: ProcurementDocument[] = html ? extractDocuments($, url) : directSpecification
    ? [{ title: clip(result.title, 200), url, kind: "specification", sourceUrl: url }] : [];
  let role: CompanyPublicRecord["role"] = "unknown";
  let roleIdentityVerified = false;
  const roles = kind === "arbitration" ? [["истец|заявитель", "claimant"], ["ответчик", "defendant"]] as const
    : [["победитель", "winner"], ["поставщик|исполнитель|участник", "supplier"], ["заказчик|организатор", "customer"]] as const;
  if (html) for (const [label, value] of roles) {
    const description = field(text, label);
    const targetInn = validInn(company.inn);
    const roleInns = listedInns(description ?? "");
    if (targetInn && roleInns.length && !roleInns.includes(targetInn)) continue;
    if (description && (hasName(description, company.companyName) || (targetInn && roleInns.includes(targetInn)))) {
      role = value;
      roleIdentityVerified = Boolean(targetInn && roleInns.includes(targetInn));
      break;
    }
  }
  const statusText = html ? field(text, kind === "arbitration" ? "статус дела|состояние дела" : "статус закупки|статус процедуры|этап закупки|этап процедуры|статус") : null;
  let status: CompanyPublicRecord["status"] = "unknown";
  if (statusText) {
    if (/не\s*состоя|несостоя/i.test(statusText)) status = "failed";
    else if (/отмен|аннулир/i.test(statusText)) status = "cancelled";
    else if (/заверш|исполнен|подведены итоги/i.test(statusText)) status = "completed";
    else if (/при[её]м заявок|подача заявок|рассмотрени|в процессе|на рассмотрении/i.test(statusText)) status = "active";
  }
  const subject = html ? field(text, "объект закупки|предмет закупки|предмет договора|предмет спора|категория спора|наименование закупки") : null;
  return {
    kind, title: clip($("h1").first().text() || result.title, 300), url, source: host, authority,
    identity, number, role, status,
    parties: html ? roles.flatMap(([label]) => {
      const description = field(text, label);
      return description ? [{ role: label.replaceAll("|", " / "), description }] : [];
    }) : [],
    verification: html && identity === "inn" && number && roleIdentityVerified && authority === "primary" ? "confirmed" : "candidate",
    contractNumbers: html ? [...text.matchAll(/(?:договор|контракт)[а-я\s]{0,20}\s*№\s*([a-zа-я\d][a-zа-я\d/._-]{5,50})/gi)].map((match) => match[1]!) : [],
    procurementReferences: html ? [...text.matchAll(/(?:закупк[аи]|тендер|извещени[ея])\s*(?:№|номер)\s*(\d{5,19})/gi)].map((match) => ({ number: match[1]!, quote: clip(text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80), 250) })) : [],
    subject,
    amount: html ? field(text, "начальная (?:максимальная )?цена(?: контракта)?|цена контракта|сумма иска|цена иска|сумма закупки|общая сумма закупки") : null,
    deadline: html ? field(text, "окончание (?:подачи|при[её]ма) заявок|дата окончания (?:подачи|при[её]ма) заявок") : null,
    outcome: html && kind === "arbitration" ? field(text, "результат рассмотрения|резолютивная часть|решение|исход дела") : null,
    evidence: clip([role !== "unknown" ? `${roles.find(([, value]) => value === role)?.[0]}: ${field(text, roles.find(([, value]) => value === role)![0])}` : "", statusText ? `Статус: ${statusText}` : "", subject, text].filter(Boolean).join(" · "), 1500),
    fetchedAt: html ? now.toISOString() : null,
    documents,
    documentsAccess: documents.length ? "links_found" : !html ? "not_checked" : /документац[\s\S]{0,200}(?:зарегистрирован|войдите|вход)|(?:войдите|зарегистрируйтесь)[\s\S]{0,100}документ/i.test(text) ? "restricted" : "not_found",
    relatedProcurementUrls: [], relationEvidence: null,
    relevance: ANIX.test(`${subject ?? ""} ${result.title}`) ? "anix" : "other",
  };
}

export function summarizeProcurement(records: CompanyPublicRecord[]): ProcurementResearch["summary"] {
  const confirmed = records.filter((record) => record.verification === "confirmed");
  const tenders = confirmed.filter((record) => record.kind === "procurement");
  const cases = confirmed.filter((record) => record.kind === "arbitration");
  const count = (key: "role" | "status", value: string) => tenders.filter((record) => record[key] === value).length;
  const nextActions = ["Выборка из открытых источников не является полным реестром участия и судебных дел."];
  if (!confirmed.length) nextActions.push("Подтверждённых карточек нет: проверить ИНН и доступность источников; не делать вывод об отсутствии торгов или споров.");
  if (tenders.some((record) => record.relevance === "anix" && record.status === "failed" && record.role === "customer")) nextActions.push("Есть несостоявшаяся профильная закупка заказчика: изучить протокол и ТЗ, проверить повторное объявление перед контактом.");
  if (tenders.some((record) => record.relevance === "anix" && record.status === "active" && record.role === "customer")) nextActions.push("Есть активная профильная закупка заказчика: проверить дедлайн и требования, затем оценить участие Anix.");
  if (cases.some((record) => record.relatedProcurementUrls.length)) nextActions.push("Есть дело с документально сопоставленным номером закупки/договора: прочитать судебный акт и проверить текущую стадию.");
  if (records.some((record) => record.documentsAccess === "restricted")) nextActions.push("Часть документации требует входа: открыть указанную карточку площадки и получить доступ к документам.");
  return { confirmedProcurements: tenders.length, candidates: records.length - confirmed.length,
    customer: count("role", "customer"), supplier: count("role", "supplier"), winner: count("role", "winner"),
    active: count("status", "active"), completed: count("status", "completed"), failed: count("status", "failed"), cancelled: count("status", "cancelled"),
    confirmedCases: cases.length, linkedCases: cases.filter((record) => record.relatedProcurementUrls.length).length,
    specificationLinks: records.flatMap((record) => record.documents).filter((document) => document.kind === "specification").length,
    relevantToAnix: tenders.filter((record) => record.relevance === "anix").length, nextActions };
}

export function linkCases(records: CompanyPublicRecord[]): void {
  const tenders = records.filter((record) => record.kind === "procurement" && record.verification === "confirmed");
  for (const record of records.filter((record) => record.kind === "arbitration" && record.verification === "confirmed")) {
    for (const tender of tenders) {
      const number = tender.number;
      const sharedContract = tender.contractNumbers.find((item) => record.contractNumbers.includes(item));
      const purchaseMatch = number && record.procurementReferences.find((reference) => reference.number === number);
      if (purchaseMatch || sharedContract) {
        record.relatedProcurementUrls.push(tender.url);
        record.relationEvidence = `В источниках совпал ${purchaseMatch ? `номер закупки ${number}: «${purchaseMatch.quote}»` : `номер договора ${sharedContract}`}; это связь по реквизиту, а не вывод о результате спора.`;
      }
    }
  }
}

interface ResearchOptions { enabled: boolean; queryBudget: number; tavilyQueryBudget: number; maxPages: number }
interface PublicSearch { searchPublicQueries(queries: string[], paidBudget: number): Promise<MultiSearchOutcome> }

async function boundedHtml(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + 8000;
  let size = 0;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("body read timeout")), Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer));
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_500_000) throw new Error("page exceeds 1.5 MB");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}

export async function researchProcurement(company: CompanyContext, search: PublicSearch, http: HttpOptions, options: ResearchOptions): Promise<ProcurementResearch> {
  const checkedAt = new Date().toISOString();
  const empty = { checkedAt, inn: validInn(company.inn), queries: [], plannedQueries: [], providers: {}, records: [], warnings: [], summary: summarizeProcurement([]) };
  if (!options.enabled) return { ...empty, status: "disabled" };
  const catalog = procurementQueries(company);
  const reserve = Math.min(3, Math.max(0, options.queryBudget - 5));
  const plannedQueries = catalog.slice(0, options.queryBudget - reserve);
  let discovery: MultiSearchOutcome;
  try { discovery = await search.searchPublicQueries(plannedQueries, options.tavilyQueryBudget); }
  catch (error) { return { ...empty, status: "unavailable", plannedQueries, warnings: [`Поиск закупок недоступен: ${error instanceof Error ? error.message : String(error)}`] }; }
  const warnings = [...discovery.warnings];
  if (!validInn(company.inn)) warnings.push("ИНН не указан или некорректен. Совпадения только по названию требуют проверки юридического лица.");
  const records: CompanyPublicRecord[] = [];
  const seen = new Set<string>();
  let fetched = 0;
  let attempted = 0;
  let candidatesCount = 0;
  const enrich = async (results: SearchResult[], pageLimit: number) => {
    const candidates = uniqueBy(results.filter((item) => publicRecordUrl(item.url) && !seen.has(item.url)), (item) => item.url).slice(0, 50);
    candidatesCount += candidates.length;
    candidates.forEach((item) => seen.add(item.url));
    // Interleave hosts to prevent one platform consuming the page budget.
    const grouped = new Map<string, SearchResult[]>();
    for (const item of candidates) {
      const host = new URL(item.url).hostname;
      grouped.set(host, [...(grouped.get(host) ?? []), item]);
      const record = parsePublicRecord(null, item, company);
      if (record) records.push(record);
    }
    const pages: SearchResult[] = [];
    while ([...grouped.values()].some((lane) => lane.length)) for (const lane of grouped.values()) if (lane.length) pages.push(lane.shift()!);
    for (let index = 0; index < Math.min(pages.length, pageLimit); index += 2) {
      await Promise.all(pages.slice(index, Math.min(index + 2, pageLimit)).map(async (item) => {
        attempted += 1;
        try {
          const response = await fetchWithRetry(item.url, { method: "GET", redirect: "manual", headers: { accept: "text/html" } }, { ...http, retries: 0, timeoutMs: Math.min(http.timeoutMs, 8000) });
          if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get("content-type") ?? "")) throw new Error(`HTTP ${response.status}; карточка HTML недоступна`);
          const html = await boundedHtml(response);
          const record = parsePublicRecord(html, item, company);
          if (!record) {
            // Drop a misleading snippet if the live page contradicts its identity.
            const existing = records.findIndex((entry) => entry.url === item.url);
            if (existing >= 0) records.splice(existing, 1);
            throw new Error("карточка не подтверждает компанию либо содержит защиту/пустую страницу");
          }
          fetched += 1;
          const existing = records.findIndex((entry) => entry.url === item.url);
          if (existing >= 0) records[existing] = record; else records.push(record);
        } catch (error) { warnings.push(`${item.url}: ${error instanceof Error ? error.message : String(error)}`); }
      }));
    }
  };
  await enrich(discovery.results, Math.max(0, options.maxPages - (reserve ? Math.min(2, options.maxPages) : 0)));
  const target = validInn(company.inn);
  const related = records.filter((record) => record.kind === "procurement" && record.verification === "confirmed" && record.number)
    .flatMap((record) => [`"${record.number}" ${target ? `"${target}"` : ""} site:kad.arbitr.ru`, `"${record.number}" ${target ? `"${target}"` : ""} site:ras.arbitr.ru`]);
  const followUp = uniqueBy([...related, ...catalog.filter((query) => !plannedQueries.includes(query))], (query) => query).slice(0, reserve);
  if (followUp.length) {
    plannedQueries.push(...followUp);
    const paidRemaining = Math.max(0, options.tavilyQueryBudget - (discovery.queryCounts?.tavily ?? options.tavilyQueryBudget));
    try {
      const follow = await search.searchPublicQueries(followUp, paidRemaining);
      warnings.push(...follow.warnings);
      await enrich(follow.results, Math.max(0, options.maxPages - attempted));
      discovery = { ...discovery, queries: [...new Set([...discovery.queries, ...follow.queries])],
        providers: Object.fromEntries([...new Set([...Object.keys(discovery.providers), ...Object.keys(follow.providers)])].map((provider) => [provider, discovery.providers[provider] === "used" || follow.providers[provider] === "used" ? "used" : follow.providers[provider] ?? discovery.providers[provider]!])) };
    } catch (error) { warnings.push(`Повторный поиск по реквизитам: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const deduplicated = uniqueBy(records.sort((left, right) => Number(right.verification === "confirmed") - Number(left.verification === "confirmed")),
    (record) => `${record.source}:${record.number ?? record.url}`);
  linkCases(deduplicated);
  const searched = Object.values(discovery.providers).some((status) => status === "used");
  return { checkedAt, inn: validInn(company.inn), status: !searched ? "unavailable" : warnings.length || fetched < candidatesCount ? "partial" : "searched",
    queries: discovery.queries, plannedQueries, providers: discovery.providers, records: deduplicated, warnings,
    summary: summarizeProcurement(deduplicated) };
}
