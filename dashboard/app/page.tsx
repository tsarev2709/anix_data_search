"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

type View = "overview" | "demand" | "contacts" | "runs" | "settings";
type Decision = "pending" | "approved" | "rejected";
type DemandStatus = "new" | "qualified" | "dismissed";
type Candidate = {
  fullName?: string | null; full_name?: string | null; position: string | null;
  emails: Array<{ value: string; generic: boolean; deliverability: string; confidence?: number; status?: "found" | "general" | "inferred"; evidenceUrl?: string; domainHasMx?: boolean | null }>;
  phones: string[]; socialUrls?: string[]; social_urls?: string[]; score: number;
  scoreReasons?: string[]; score_reasons?: string[];
  evidence: Array<{ url: string; title: string; source: string; snippet?: string }>;
};
type Contact = Candidate & {
  id: number; company_name: string; source_lead_id: number; full_name: string | null;
  social_urls: string[]; score_reasons: string[];
  decision: Decision; synced_at: string | null; created_at: string;
};
type Run = {
  id: string; started_at: string; finished_at: string | null; mode: string; status: string;
  companies_count: number; candidates_count: number; selected_count: number; failures_count: number;
  metrics?: Record<string, unknown> & { searchQueries?: number; pagesCrawled?: number; searchResults?: number; peopleFound?: number; positionsFound?: number; emailsFound?: number; personalEmailsFound?: number; inferredEmailsFound?: number; phonesFound?: number; telegramFound?: number; socialProfilesFound?: number; providerFailures?: number; socialByPlatform?: Record<string, number> };
};
type WorkflowStep = { name: string; status: string; conclusion: string | null; number: number };
type WorkflowRun = {
  id: number; run_number: number | null; status: string; conclusion: string | null;
  created_at: string | null; updated_at: string | null; started_at: string | null;
  url: string | null; current_step: string | null; steps: WorkflowStep[];
};
type WorkflowSnapshot = {
  configured: boolean; available: boolean; latest: WorkflowRun | null;
  error?: { code: string; stage: string; message: string; http_status?: number };
  jobs_error?: { code: string; stage: string; message: string; http_status?: number } | null;
};
type DispatchResponse = {
  ok: boolean; request_id: string;
  dispatch: { status: string; operation: "research" | "research-company" | "monitor-demand" | "sync-approved"; mode: string; max_companies: number; company_name?: string | null; company_website?: string | null; requested_at: string };
};
type DemandSignal = {
  id: number; fingerprint: string; last_run_id: string | null; source: string; category: string; intent: string; query: string;
  title: string; url: string; snippet: string; author: string | null; published_at: string | null; first_seen_at: string; last_seen_at: string;
  score: number; score_reasons: string[]; emails: string[]; phones: string[]; social_urls: string[]; status: DemandStatus;
};
type DemandRun = { id: string; started_at: string; finished_at: string | null; status: string; queries_count: number; results_count: number; signals_count: number; failures_count: number; providers: Record<string, string> };
type CompanyRun = {
  id: number; run_id: string; source_lead_id: number; source_lead_name: string | null; source_company_id: number | null;
  company_name: string; source_website: string | null; website: string | null; duration_ms: number; warnings: string[];
  candidates: Candidate[]; selected_candidates: Candidate[];
  company_context?: { source?: "amo" | "manual" };
  actions: Array<{ type: string; status: string; detail: string }>;
  research_trace: {
    searchQueries?: string[];
    searchResults?: Array<{ title: string; url: string; content?: string; provider?: string; query?: string; publishedAt?: string | null }>;
    crawledPages?: Array<{ title: string; url: string; emails: string[]; phones: string[]; socialUrls: string[] }>;
    evidence?: Array<{ title: string; url: string; source: string; snippet?: string }>;
    socialProfiles?: Array<{ platform: string; kind?: string; url: string; username: string | null; displayName: string | null; personName: string | null; role: string | null; confidence: number; evidenceUrl: string; lastSeen: string }>;
    providerFailures?: Array<{ provider: string; message: string }>;
    crawlDiagnostics?: { robotsUrl: string | null; sitemapUrls: string[]; sitemapEntries: number; feedUrls: string[]; pdfUrls: string[]; jsFallbacks: number; wordpress: boolean };
    socialEnrichment?: { attempted: number; succeeded: number; failed: number; pages: Array<{ platform: string; url: string; title: string; emails: string[]; phones: string[]; socialUrls: string[] }> };
    providers?: Record<string, string>;
  };
};
type DashboardData = {
  runs: Run[]; companies: CompanyRun[]; contacts: Contact[]; demand_runs: DemandRun[]; demand_signals: DemandSignal[];
  status: { amo: boolean; github: boolean; supabase: boolean; auto_apply: boolean };
  workflow: WorkflowSnapshot;
  request_id: string;
  diagnostics: { generated_at: string; storage: { runs: string; companies?: string; contacts: string; demand_runs?: string; demand_signals?: string }; workflow: string };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const configured = Boolean(supabaseUrl && supabaseAnonKey);
const supabase = configured ? createClient(supabaseUrl, supabaseAnonKey) : null;
const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Обзор", icon: "⌁" },
  { id: "demand", label: "Спрос", icon: "◎" },
  { id: "contacts", label: "Контакты", icon: "◉" },
  { id: "runs", label: "Запуски", icon: "↻" },
  { id: "settings", label: "Настройки", icon: "◇" },
];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function initials(name: string | null, company: string) {
  return (name || company).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
async function callAdmin<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${supabaseUrl}/functions/v1/contact-search-admin${path}`, {
    ...init,
    headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string; stage?: string; request_id?: string };
    const technical = [body.stage, body.code, body.request_id].filter(Boolean).join(" · ");
    throw new Error(`${body.error || `HTTP ${response.status}`}${technical ? ` (${technical})` : ""}`);
  }
  return response.json() as Promise<T>;
}

function workflowTone(run: WorkflowRun | null) {
  if (!run) return "waiting";
  if (run.status !== "completed") return "running";
  return run.conclusion === "success" ? "success" : "failed";
}

function workflowTitle(run: WorkflowRun | null, awaitingStart: boolean) {
  if (!run || awaitingStart) return "Команда принята — ждём старт";
  if (run.status === "queued") return "Запуск стоит в очереди";
  if (run.status === "in_progress") return "Поиск выполняется";
  if (run.conclusion === "success") return "Поиск завершён";
  if (run.conclusion === "cancelled") return "Запуск отменён";
  return "Запуск завершился с ошибкой";
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const { error: authError } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    if (authError) setError(authError.message); else setSent(true);
  };
  return <main className="auth-shell"><section className="auth-card"><Brand />
    <p className="eyebrow auth-eyebrow">ANIX · DATA OPERATIONS</p><h1>Контакты, которые<br />можно проверить.</h1>
    <p className="auth-copy">Закрытая панель поиска ЛПР, оценки источников и синхронизации с AmoCRM.</p>
    {sent ? <div className="success-note"><strong>Ссылка отправлена</strong><span>Откройте письмо на {email}</span></div> :
      <form onSubmit={submit} className="auth-form"><label>Рабочая почта</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@anix-ai.pro" required /><button className="primary-button" type="submit">Войти по ссылке <span>→</span></button>{error && <p className="error-text">{error}</p>}</form>}
    <p className="privacy-copy">Доступ разрешён только администраторам из защищённого списка.</p>
  </section></main>;
}
function Brand({ compact = false }: { compact?: boolean }) { return <div className={`brand-mark ${compact ? "compact" : ""}`}><span>A</span></div>; }
function SetupScreen() { return <main className="auth-shell"><section className="auth-card setup-card"><Brand /><p className="eyebrow auth-eyebrow">ANIX CONTACT SEARCH</p><h1>Интерфейс готов.<br />Осталось подключить данные.</h1><p className="auth-copy">Добавьте Supabase URL и публичный anon key в GitHub Secrets. После следующего деплоя здесь появится вход и рабочая очередь.</p><div className="setup-list"><span><b>1</b> Supabase Auth и таблицы</span><span><b>2</b> GitHub Actions token</span><span><b>3</b> AmoCRM secrets</span></div></section></main>; }
function StatCard({ label, value, foot, tone }: { label: string; value: string | number; foot: string; tone?: string }) { return <article className={`stat-card ${tone ?? ""}`}><p>{label}</p><strong>{value}</strong><span>{foot}</span></article>; }

function App({ session }: { session: Session }) {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<Decision | "all">("pending");
  const [demandFilter, setDemandFilter] = useState<DemandStatus | "all">("new");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [dispatchInfo, setDispatchInfo] = useState<DispatchResponse | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const refresh = useCallback(async () => { setError(""); try { setData(await callAdmin<DashboardData>(session, "/dashboard")); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setLoading(false); } }, [session]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const activeWorkflow = data?.workflow?.latest?.status === "queued" || data?.workflow?.latest?.status === "in_progress";
  const trackedWorkflow = data?.workflow?.latest;
  const trackedWorkflowMatches = Boolean(dispatchInfo && trackedWorkflow?.created_at && new Date(trackedWorkflow.created_at).getTime() >= new Date(dispatchInfo.dispatch.requested_at).getTime() - 15000);
  const trackedWorkflowFinished = trackedWorkflowMatches && trackedWorkflow?.status === "completed";
  useEffect(() => {
    if (!activeWorkflow && (!dispatchInfo || trackedWorkflowFinished)) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [activeWorkflow, dispatchInfo, refresh, trackedWorkflowFinished]);
  const decide = async (id: number, decision: Decision) => { setBusy(`contact-${id}`); try { await callAdmin(session, `/candidates/${id}`, { method: "PATCH", body: JSON.stringify({ decision }) }); setData((current) => current ? { ...current, contacts: current.contacts.map((item) => item.id === id ? { ...item, decision } : item) } : current); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setBusy(""); } };
  const decideDemand = async (id: number, status: DemandStatus) => { setBusy(`demand-${id}`); try { await callAdmin(session, `/demand-signals/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setData((current) => current ? { ...current, demand_signals: current.demand_signals.map((item) => item.id === id ? { ...item, status } : item) } : current); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setBusy(""); } };
  const dispatch = async (operation: "research" | "research-company" | "monitor-demand" | "sync-approved", options: { company_name?: string; company_website?: string } = {}) => { setBusy(operation); setError(""); try { const accepted = await callAdmin<DispatchResponse>(session, "/dispatch", { method: "POST", body: JSON.stringify({ operation, max_companies: 10, ...options }) }); setDispatchInfo(accepted); setView("runs"); window.setTimeout(() => void refresh(), 1200); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setBusy(""); } };
  const filteredContacts = useMemo(() => (data?.contacts ?? []).filter((item) => filter === "all" || item.decision === filter), [data, filter]);
  const filteredDemand = useMemo(() => (data?.demand_signals ?? []).filter((item) => demandFilter === "all" || item.status === demandFilter), [data, demandFilter]);
  const pending = data?.contacts.filter((item) => item.decision === "pending").length ?? 0;
  const approved = data?.contacts.filter((item) => item.decision === "approved" && !item.synced_at).length ?? 0;
  const newDemand = data?.demand_signals.filter((item) => item.status === "new").length ?? 0;
  const latest = data?.runs[0];
  const latestWorkflow = data?.workflow?.latest ?? null;
  const awaitingWorkflow = Boolean(dispatchInfo && !trackedWorkflowMatches);

  return <div className="app-shell"><aside className="sidebar"><div className="logo-row"><Brand compact /><div><strong>Anix</strong><small>Contact Intelligence</small></div></div><nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><i>{item.icon}</i>{item.label}{item.id === "contacts" && pending > 0 && <em>{pending}</em>}{item.id === "demand" && newDemand > 0 && <em>{newDemand}</em>}</button>)}</nav><div className="sidebar-foot"><span className={activeWorkflow || awaitingWorkflow ? "status-dot working" : data?.status.github ? "status-dot online" : "status-dot"}></span><div><strong>{activeWorkflow || awaitingWorkflow ? "Поиск выполняется" : data?.status.github ? "Система работает" : "Система не настроена"}</strong><small>{latestWorkflow?.current_step || (latest ? `Запуск ${formatDate(latest.finished_at)}` : "Запусков пока нет")}</small></div></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">КОНТУР ПРОДАЖ</p><h1>{navItems.find((item) => item.id === view)?.label}</h1></div><div className="top-actions"><button className="ghost-button" onClick={() => void refresh()}>↻ Обновить</button><button className="primary-button small" disabled={Boolean(busy)} onClick={() => void dispatch("research")}>{busy === "research" ? "Запускаем…" : "Найти контакты"}<span>→</span></button><button className="user-button" title={session.user.email ?? ""}>{session.user.email?.[0]?.toUpperCase()}</button></div></header>
      {error && <div className="error-banner"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
      {loading ? <div className="loading-grid"><i></i><i></i><i></i></div> : <>
        {view === "overview" && <section className="view-stack"><WorkflowMonitor snapshot={data?.workflow} awaitingStart={awaitingWorkflow} requestId={dispatchInfo?.request_id || data?.request_id} /><div className="stats-grid"><StatCard label="Ждут решения" value={pending} foot="найденных контактов" tone="accent" /><StatCard label="Новые сигналы спроса" value={newDemand} foot="запросы и рекомендации" /><StatCard label="Готовы к AmoCRM" value={approved} foot="одобрены, не отправлены" /><StatCard label="Ошибок" value={latest?.failures_count ?? 0} foot="в последнем запуске" tone={(latest?.failures_count ?? 0) > 0 ? "danger" : ""} /></div>
          <div className="overview-grid"><section className="panel queue-panel"><div className="panel-head"><div><p className="eyebrow">ПРИОРИТЕТ</p><h2>Контакты на проверку</h2></div><button className="text-button" onClick={() => setView("contacts")}>Открыть все →</button></div>{(data?.contacts ?? []).filter((item) => item.decision === "pending").slice(0, 4).map((contact) => <div className="contact-row" key={contact.id}><div className="avatar">{initials(contact.full_name, contact.company_name)}</div><div className="contact-main"><strong>{contact.full_name || contact.emails[0]?.value || "Общий контакт"}</strong><span>{contact.position || contact.company_name}</span></div><div className="score">{contact.score}</div><div className="row-actions"><button onClick={() => void decide(contact.id, "rejected")}>×</button><button className="approve" onClick={() => void decide(contact.id, "approved")}>✓</button></div></div>)}{pending === 0 && <Empty icon="⌁" title="Очередь пуста" text="Запустите поиск — новые контакты появятся здесь." />}</section>
            <section className="panel run-panel"><div className="panel-head"><div><p className="eyebrow">АВТОМАТИЗАЦИЯ</p><h2>Ежедневный цикл</h2></div><span className="live-pill">05:20 МСК</span></div><div className="run-flow"><Flow n="1" title="Радар спроса" text="Чаты, форумы, новости" done /><div className="flow-line"></div><Flow n="2" title="AmoCRM + OSINT" text="10 компаний из очереди" done /><div className="flow-line"></div><Flow n="3" title="Ваше решение" text="Одобрить или отклонить" /></div><button className="primary-button full" disabled={approved === 0 || Boolean(busy)} onClick={() => void dispatch("sync-approved")}>{busy === "sync-approved" ? "Отправляем…" : `Отправить одобренные в AmoCRM (${approved})`}<span>→</span></button></section></div>
          <div className="intelligence-grid"><section className="panel manual-company"><div className="panel-head"><div><p className="eyebrow">ТОЧЕЧНАЯ РАЗВЕДКА</p><h2>Собрать всё по компании</h2></div></div><form onSubmit={(event) => { event.preventDefault(); if (companyName.trim()) void dispatch("research-company", { company_name: companyName.trim(), company_website: companyWebsite.trim() }); }}><label>Название компании<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Например: Мосфарма" required /></label><label>Сайт, если известен<input value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} placeholder="https://example.ru" type="url" /></label><button className="primary-button" disabled={Boolean(busy)} type="submit">{busy === "research-company" ? "Запускаем…" : "Исследовать компанию"}<span>→</span></button></form><p>Если сайта нет, система найдёт его по названию и затем пройдёт сайт, документы, новости и публичные соцпрофили.</p></section>
            <section className="panel demand-preview"><div className="panel-head"><div><p className="eyebrow">РАДАР СПРОСА</p><h2>Где сейчас ищут подрядчика</h2></div><button className="text-button" onClick={() => setView("demand")}>Открыть все →</button></div>{(data?.demand_signals ?? []).filter((item) => item.status === "new").slice(0, 3).map((signal) => <a href={signal.url} target="_blank" rel="noreferrer" key={signal.id}><b>{signal.score}</b><span><strong>{signal.title}</strong><small>{signal.source} · {signal.category} · {formatDate(signal.published_at || signal.last_seen_at)}</small></span></a>)}{newDemand === 0 && <Empty icon="◎" title="Новых сигналов пока нет" text="Запустите радар вручную или дождитесь ежедневного цикла." />}<button className="ghost-button full" disabled={Boolean(busy)} onClick={() => void dispatch("monitor-demand")}>{busy === "monitor-demand" ? "Запускаем…" : "Проверить спрос сейчас"}</button></section></div></section>}
        {view === "demand" && <section className="view-stack"><div className="toolbar"><div className="segmented">{(["new", "qualified", "dismissed", "all"] as const).map((item) => <button className={demandFilter === item ? "active" : ""} onClick={() => setDemandFilter(item)} key={item}>{item === "new" ? "Новые" : item === "qualified" ? "Интересные" : item === "dismissed" ? "Не подходит" : "Все"}</button>)}</div><button className="primary-button small" disabled={Boolean(busy)} onClick={() => void dispatch("monitor-demand")}>{busy === "monitor-demand" ? "Запускаем…" : "Обновить радар"}</button></div><div className="demand-grid">{filteredDemand.map((signal) => <DemandCard key={signal.id} signal={signal} busy={busy === `demand-${signal.id}`} decide={decideDemand} />)}{filteredDemand.length === 0 && <div className="empty-state wide"><div>◎</div><strong>Сигналов в этом фильтре нет</strong><span>Радар выполняется ежедневно и сохраняет новые упоминания без дублей.</span></div>}</div></section>}
        {view === "contacts" && <section className="view-stack"><div className="toolbar"><div className="segmented">{(["pending", "approved", "rejected", "all"] as const).map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item === "pending" ? "Новые" : item === "approved" ? "Одобрены" : item === "rejected" ? "Отклонены" : "Все"}</button>)}</div><button className="primary-button small" disabled={approved === 0 || Boolean(busy)} onClick={() => void dispatch("sync-approved")}>В AmoCRM · {approved}</button></div><div className="contact-grid">{filteredContacts.map((contact) => <ContactCard key={contact.id} contact={contact} busy={busy === `contact-${contact.id}`} decide={decide} />)}{filteredContacts.length === 0 && <div className="empty-state wide"><div>◉</div><strong>Здесь пока пусто</strong><span>Для этого фильтра контактов нет.</span></div>}</div></section>}
        {view === "runs" && <section className="view-stack"><WorkflowMonitor snapshot={data?.workflow} awaitingStart={awaitingWorkflow} requestId={dispatchInfo?.request_id || data?.request_id} /><section className="panel runs-table"><div className="panel-head"><div><p className="eyebrow">ЖУРНАЛ</p><h2>История результатов</h2></div><span className="run-help">Нажмите на запуск для подробностей</span></div><div className="table-head"><span>Запуск</span><span>Режим</span><span>Компании</span><span>Найдено</span><span>Ошибки</span><span>Статус</span></div>{(data?.runs ?? []).map((run) => <div className="run-record" key={run.id}><button className="table-row run-toggle" onClick={() => setExpandedRun((current) => current === run.id ? null : run.id)}><span><strong>{formatDate(run.started_at)}</strong><small>{run.id.slice(0, 10)}</small></span><span>{run.mode}</span><span>{run.companies_count}</span><span>{run.selected_count}</span><span>{run.failures_count}</span><span><b className={`run-status ${run.status}`}>{run.status}</b><i>{expandedRun === run.id ? "−" : "+"}</i></span></button>{expandedRun === run.id && <RunAudit run={run} companies={(data?.companies ?? []).filter((company) => company.run_id === run.id)} />}</div>)}{(data?.runs ?? []).length === 0 && <Empty icon="↻" title="Готовых результатов ещё нет" text="Текущий технический статус показан выше." />}</section></section>}
        {view === "settings" && <section className="settings-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">ИНТЕГРАЦИИ</p><h2>Состояние системы</h2></div></div><div className="integration-list">{[["AmoCRM", data?.status.amo, "Сделки, контакты и задачи"], ["GitHub Actions", data?.status.github, "Поиск и деплой"], ["Supabase", data?.status.supabase, "Доступ и история"]].map(([name, active, detail]) => <div key={String(name)}><span className={active ? "integration-icon active" : "integration-icon"}>{String(name)[0]}</span><span><strong>{String(name)}</strong><small>{String(detail)}</small></span><b className={active ? "connected" : "disconnected"}>{active ? "Подключено" : "Не настроено"}</b></div>)}</div></section><section className="panel settings-copy"><p className="eyebrow">РЕЖИМ</p><h2>{data?.status.auto_apply ? "Автоприменение включено" : "Ручное одобрение"}</h2><p>Контакт попадает в AmoCRM только после проверки в этой панели. Это защищает базу от дублей и нерелевантных адресов.</p><div className="safe-badge">✓ Безопасный режим</div><button className="ghost-button full" onClick={() => void supabase?.auth.signOut()}>Выйти из панели</button></section></section>}
      </>}
  </main></div>;
}

function friendlyStep(name: string) {
  const labels: Record<string, string> = {
    "Set up job": "Подготовка сервера",
    "Run npm ci": "Установка зависимостей",
    "Install Chromium for selective JavaScript fallback": "Подготовка браузера для SPA-сайтов",
    "Run npm run check": "Проверка кода и настроек",
    "Run contact intelligence": "Мониторинг спроса и поиск контактов",
    "Add report to job summary": "Формирование отчёта",
    "Upload audit report": "Сохранение отчёта",
    "Complete job": "Завершение запуска",
  };
  if (labels[name]) return labels[name];
  if (name.includes("checkout")) return "Получение актуальной версии";
  if (name.includes("setup-node")) return "Подготовка Node.js";
  return name.replace(/^Run\s+/, "");
}

function WorkflowMonitor({ snapshot, awaitingStart, requestId }: { snapshot?: WorkflowSnapshot; awaitingStart: boolean; requestId?: string }) {
  if (snapshot && !snapshot.available) {
    return <section className="workflow-monitor failed"><div className="workflow-summary"><div><p className="eyebrow">ТЕХНИЧЕСКИЙ СТАТУС</p><h2>Не удалось прочитать состояние запуска</h2><p>{snapshot.error?.message || "GitHub Actions не отвечает"}</p></div><b>ОШИБКА СВЯЗИ</b></div><code>{snapshot.error?.stage} · {snapshot.error?.code} · {requestId}</code></section>;
  }
  const run = snapshot?.latest ?? null;
  const tone = awaitingStart ? "waiting" : workflowTone(run);
  const steps = run?.steps ?? [];
  const failed = steps.find((step) => step.conclusion === "failure");
  const active = steps.find((step) => step.status === "in_progress");
  return <section className={`workflow-monitor ${tone}`}>
    <div className="workflow-summary"><div><p className="eyebrow">ТЕКУЩИЙ ЗАПУСК</p><h2>{workflowTitle(run, awaitingStart)}</h2><p>{awaitingStart ? "GitHub принял команду. Панель проверяет появление нового запуска каждые 5 секунд." : failed ? `Сбой на этапе: ${friendlyStep(failed.name)}` : active ? `Сейчас: ${friendlyStep(active.name)}` : run?.current_step ? `Последний этап: ${friendlyStep(run.current_step)}` : "Запусков пока нет."}</p></div><b>{awaitingStart ? "ПРИНЯТО" : run?.status === "completed" ? run.conclusion === "success" ? "ГОТОВО" : "ОШИБКА" : run?.status === "in_progress" ? "В РАБОТЕ" : run?.status === "queued" ? "В ОЧЕРЕДИ" : "НЕТ ЗАПУСКА"}</b></div>
    {steps.length > 0 && <div className="workflow-steps">{steps.map((step) => <div className={`${step.status} ${step.conclusion ?? ""}`} key={`${step.number}-${step.name}`}><i>{step.conclusion === "success" ? "✓" : step.conclusion === "failure" ? "!" : step.status === "in_progress" ? "↻" : "·"}</i><span>{friendlyStep(step.name)}</span><small>{step.conclusion === "failure" ? "ошибка" : step.status === "in_progress" ? "выполняется" : step.conclusion === "success" ? "готово" : "ожидает"}</small></div>)}</div>}
    <div className="workflow-meta"><span>Диагностика: {requestId || "—"}</span>{run?.created_at && <span>Старт: {formatDate(run.created_at)}</span>}{run?.url && <a href={run.url} target="_blank" rel="noreferrer">Открыть полный технический лог →</a>}</div>
  </section>;
}

function candidateName(candidate: Candidate) {
  return candidate.fullName ?? candidate.full_name ?? candidate.emails[0]?.value ?? candidate.phones[0] ?? "Контакт без имени";
}

function candidateKey(candidate: Candidate) {
  return candidate.emails[0]?.value ?? candidate.phones[0] ?? `${candidate.fullName ?? candidate.full_name ?? ""}|${candidate.position ?? ""}`;
}

function RunAudit({ run, companies }: { run: Run; companies: CompanyRun[] }) {
  if (companies.length === 0) return <div className="audit-empty"><strong>Детали этого запуска ещё не сохранялись</strong><span>Запустите новый поиск — в нём будет полный аудит по 10 компаниям.</span></div>;
  const metrics = run.metrics ?? {};
  return <div className="run-audit"><div className="audit-summary"><span><b>{companies.length}</b> компаний</span><span><b>{run.candidates_count}</b> кандидатов</span><span><b>{run.selected_count}</b> прошли фильтр</span><span><b>{metrics.searchQueries ?? 0}</b> запросов</span><span><b>{metrics.pagesCrawled ?? 0}</b> страниц</span><span><b>{metrics.peopleFound ?? 0}</b> ФИО</span><span><b>{metrics.positionsFound ?? 0}</b> должностей</span><span><b>{metrics.personalEmailsFound ?? 0}</b> личных email</span><span><b>{metrics.telegramFound ?? 0}</b> Telegram</span><span><b>{metrics.phonesFound ?? 0}</b> телефонов</span><span><b>{metrics.socialProfilesFound ?? 0}</b> соцпрофилей</span></div>{companies.map((company, index) => <CompanyAudit key={company.id} company={company} index={index} />)}</div>;
}

function CompanyAudit({ company, index }: { company: CompanyRun; index: number }) {
  const trace = company.research_trace ?? {};
  const queries = trace.searchQueries ?? [];
  const results = trace.searchResults ?? [];
  const pages = trace.crawledPages ?? [];
  const candidates = company.candidates ?? [];
  const selected = company.selected_candidates ?? [];
  const selectedKeys = new Set(selected.map(candidateKey));
  const socials = trace.socialProfiles ?? [];
  const crawl = trace.crawlDiagnostics;
  const socialEnrichment = trace.socialEnrichment;
  const peopleCount = candidates.filter((candidate) => candidate.fullName || candidate.full_name).length;
  const positionCount = candidates.filter((candidate) => candidate.position).length;
  const directChannelCount = candidates.filter((candidate) => candidate.emails.some((email) => email.status !== "inferred") || candidate.phones.length > 0 || (candidate.socialUrls ?? candidate.social_urls ?? []).length > 0).length;
  const amoLeadUrl = company.company_context?.source === "manual" || company.source_lead_id === 0 ? null : `https://studioanixaipro.amocrm.ru/leads/detail/${company.source_lead_id}`;
  const amoCompanyUrl = company.source_company_id ? `https://studioanixaipro.amocrm.ru/companies/detail/${company.source_company_id}` : null;
  return <details className="company-audit" open={index === 0}><summary><span className="company-number">{index + 1}</span><span><strong>{company.company_name}</strong><small>Сделка #{company.source_lead_id} · {company.source_lead_name || "без названия"}</small></span><span className="company-audit-counts"><b>{selected.length}</b> отобрано<small>{Math.round(company.duration_ms / 100) / 10} сек.</small></span></summary><div className="company-audit-body">
    <div className="audit-links">{amoLeadUrl && <a href={amoLeadUrl} target="_blank" rel="noreferrer">Открыть сделку AmoCRM ↗</a>}{amoCompanyUrl && <a href={amoCompanyUrl} target="_blank" rel="noreferrer">Открыть компанию ↗</a>}{company.website && <a href={company.website} target="_blank" rel="noreferrer">Официальный сайт ↗</a>}</div>
    <div className="provider-strip">{Object.entries(trace.providers ?? {}).map(([name, status]) => <span className={`provider ${status}`} key={name}><b>{name}</b>{status === "used" ? "отработал" : status === "disabled" ? "не подключён" : status === "failed" ? "ошибка" : "пропущен"}</span>)}</div>
    {(crawl || socialEnrichment) && <div className="crawl-stats">{crawl && <><span>Sitemap: <b>{crawl.sitemapEntries}</b> URL</span><span>RSS: <b>{crawl.feedUrls.length}</b></span><span>PDF: <b>{crawl.pdfUrls.length}</b></span><span>JS fallback: <b>{crawl.jsFallbacks}</b></span><span>WordPress: <b>{crawl.wordpress ? "да" : "нет"}</b></span></>}{socialEnrichment && <><span>Соцпрофилей проверено: <b>{socialEnrichment.attempted}</b></span><span>Прочитано: <b>{socialEnrichment.succeeded}</b></span><span>Недоступно: <b>{socialEnrichment.failed}</b></span></>}</div>}
    <div className="audit-columns"><section><p className="audit-title">Поисковые запросы · {queries.length}</p>{queries.length > 0 ? <ol className="query-list">{queries.map((query) => <li key={query}>{query}</li>)}</ol> : <p className="audit-muted">Внешний поиск не выполнялся.</p>}</section><section><p className="audit-title">Обход сайта · {pages.length} страниц</p>{pages.length > 0 ? <div className="source-list">{pages.map((page) => <a href={page.url} target="_blank" rel="noreferrer" key={page.url}><strong>{page.title}</strong><small>{page.emails.length} email · {page.phones.length} телефонов · {page.socialUrls.length} соцсетей</small></a>)}</div> : <p className="audit-muted">Страницы не обойдены: в CRM нет сайта или он недоступен.</p>}</section></div>
    {results.length > 0 && <section className="audit-section"><p className="audit-title">Результаты веб-поиска · {results.length}</p><div className="search-result-grid">{results.map((result) => <a href={result.url} target="_blank" rel="noreferrer" key={result.url}><b>{result.provider || "web"}{result.publishedAt ? ` · ${formatDate(result.publishedAt)}` : ""}</b><strong>{result.title}</strong><span>{result.content || result.url}</span></a>)}</div></section>}
    {socials.length > 0 && <section className="audit-section"><p className="audit-title">Социальные профили · {socials.length}</p><div className="social-audit-grid">{socials.map((profile) => <a href={profile.url} target="_blank" rel="noreferrer" key={`${profile.platform}-${profile.url}`}><b>{profile.platform} · {profile.kind || "unknown"}</b><strong>{profile.personName || profile.displayName || profile.username || "Профиль"}</strong><span>{profile.role || `confidence ${profile.confidence}%`}</span></a>)}</div></section>}
    {selected.length === 0 && <section className="audit-nothing"><strong>Почему нет готового контакта</strong><span>{company.website ? "Официальный сайт определён." : "Официальный сайт не определён."} Просмотрено {pages.length} страниц, sitemap содержит {crawl?.sitemapEntries ?? 0} URL, поисковые источники дали {results.length} результатов. Найдено {peopleCount} упоминаний ФИО и {positionCount} должностей; кандидатов с прямым каналом — {directChannelCount}. Ни один кандидат одновременно не подтвердил нужную роль, связь с компанией и пригодный прямой канал выше порога.</span></section>}
    <section className="audit-section"><p className="audit-title">Кандидаты · {candidates.length}</p>{candidates.length > 0 ? <div className="audit-candidates">{candidates.map((candidate, candidateIndex) => <CandidateAudit key={`${candidateName(candidate)}-${candidateIndex}`} candidate={candidate} selected={selectedKeys.has(candidateKey(candidate))} />)}</div> : <p className="audit-muted">Не найдено ни одного email, телефона или профиля. Ниже указаны причины.</p>}</section>
    {company.warnings?.length > 0 && <section className="warning-list"><p className="audit-title">Ограничения и проблемы</p>{company.warnings.map((warning) => <div key={warning}>! {warning}</div>)}</section>}
    {(trace.providerFailures ?? []).length > 0 && <section className="warning-list"><p className="audit-title">Сбои providers</p>{trace.providerFailures!.map((failure) => <div key={`${failure.provider}-${failure.message}`}>{failure.provider}: {failure.message}</div>)}</section>}
  </div></details>;
}

function CandidateAudit({ candidate, selected }: { candidate: Candidate; selected: boolean }) {
  const socials = candidate.socialUrls ?? candidate.social_urls ?? [];
  const reasons = candidate.scoreReasons ?? candidate.score_reasons ?? [];
  return <article><div><strong>{candidateName(candidate)}</strong><span>{candidate.position || "Должность не найдена"}</span><small>{selected ? "ВЫБРАН: есть подтверждённый прямой канал" : "ОТКЛОНЁН: ниже порога или нет подтверждённого прямого канала"}</small></div><b className={selected ? "candidate-pass" : "candidate-low"}>{candidate.score}/100</b><div className="candidate-channels">{candidate.emails.map((email) => <a href={email.status === "inferred" ? undefined : `mailto:${email.value}`} key={email.value}>{email.value}<small>{email.status === "inferred" ? "INFERRED — не будет записан в CRM" : email.status === "general" || email.generic ? "GENERAL · общий" : "FOUND · персональный"} · MX {email.domainHasMx === true ? "есть" : email.domainHasMx === false ? "нет" : "неизвестен"}</small></a>)}{candidate.phones.map((phone) => <a href={`tel:${phone}`} key={phone}>{phone}</a>)}{socials.map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}>Профиль ↗</a>)}</div><div className="candidate-reasons">{reasons.map((reason) => <span key={reason}>{reason}</span>)}</div><div className="candidate-evidence">{candidate.evidence.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.source}-${source.url}`}>{source.source}: {source.title}</a>)}</div></article>;
}

function Flow({ n, title, text, done = false }: { n: string; title: string; text: string; done?: boolean }) { return <div className={`flow-step ${done ? "done" : ""}`}><i>{n}</i><span><b>{title}</b><small>{text}</small></span></div>; }
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><span>{text}</span></div>; }
function ContactCard({ contact, busy, decide }: { contact: Contact; busy: boolean; decide: (id: number, decision: Decision) => Promise<void> }) { return <article className="contact-card"><div className="card-top"><div className="avatar large">{initials(contact.full_name, contact.company_name)}</div><div><p className="company-label">{contact.company_name}</p><h3>{contact.full_name || "Общий контакт"}</h3><span>{contact.position || "Должность не указана"}</span></div><div className="score-ring"><strong>{contact.score}</strong><small>/100</small></div></div><div className="channel-list">{contact.emails.slice(0, 2).map((email) => <a href={`mailto:${email.value}`} key={email.value}><i>@</i><span>{email.value}<small>{email.deliverability === "deliverable" ? "Проверен" : email.generic ? "Общий" : "Не проверен"}</small></span></a>)}{contact.phones.slice(0, 1).map((phone) => <a href={`tel:${phone}`} key={phone}><i>☎</i><span>{phone}<small>Телефон</small></span></a>)}</div><div className="evidence-row"><span>{contact.evidence.length} источника</span><div>{contact.evidence.slice(0, 3).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title}>{source.source[0]?.toUpperCase()}</a>)}</div></div><div className="card-actions"><button className={contact.decision === "rejected" ? "selected reject" : "reject"} disabled={busy} onClick={() => void decide(contact.id, "rejected")}>Отклонить</button><button className={contact.decision === "approved" ? "selected accept" : "accept"} disabled={busy} onClick={() => void decide(contact.id, "approved")}>{contact.synced_at ? "В AmoCRM ✓" : "Одобрить"}</button></div></article>; }

function DemandCard({ signal, busy, decide }: { signal: DemandSignal; busy: boolean; decide: (id: number, status: DemandStatus) => Promise<void> }) {
  const channels = [...signal.emails.map((value) => ({ value, href: `mailto:${value}` })), ...signal.phones.map((value) => ({ value, href: `tel:${value}` })), ...signal.social_urls.map((value) => ({ value, href: value }))];
  return <article className="demand-card"><div className="demand-card-head"><div><p>{signal.source} · {signal.category}</p><span>{signal.intent} · {formatDate(signal.published_at || signal.last_seen_at)}</span></div><b>{signal.score}<small>/100</small></b></div><a className="demand-title" href={signal.url} target="_blank" rel="noreferrer"><h3>{signal.title}</h3><span>Открыть источник ↗</span></a><p className="demand-snippet">{signal.snippet || "Источник не отдал текст. Откройте публикацию для проверки."}</p>{signal.author && <div className="demand-author">Автор или канал: <b>{signal.author}</b></div>}{channels.length > 0 && <div className="demand-channels">{channels.map((channel) => <a href={channel.href} target={channel.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" key={channel.value}>{channel.value}</a>)}</div>}<div className="demand-reasons">{signal.score_reasons.map((reason) => <span key={reason}>{reason}</span>)}</div><details><summary>Какой запрос сработал</summary><code>{signal.query}</code></details><div className="card-actions"><button className={signal.status === "dismissed" ? "selected reject" : "reject"} disabled={busy} onClick={() => void decide(signal.id, "dismissed")}>Не подходит</button><button className={signal.status === "qualified" ? "selected accept" : "accept"} disabled={busy} onClick={() => void decide(signal.id, "qualified")}>Интересно</button></div></article>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(configured);
  useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); }); const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)); return () => data.subscription.unsubscribe(); }, []);
  if (!configured) return <SetupScreen />;
  if (checking) return <main className="auth-shell"><div className="loader"></div></main>;
  if (!session) return <SignIn />;
  return <App session={session} />;
}
