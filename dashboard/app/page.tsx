"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

type View = "overview" | "contacts" | "runs" | "settings";
type Decision = "pending" | "approved" | "rejected";
type Contact = {
  id: number; company_name: string; source_lead_id: number; full_name: string | null;
  position: string | null; emails: Array<{ value: string; generic: boolean; deliverability: string; confidence?: number }>;
  phones: string[]; social_urls: string[]; score: number; score_reasons: string[];
  evidence: Array<{ url: string; title: string; source: string }>;
  decision: Decision; synced_at: string | null; created_at: string;
};
type Run = {
  id: string; started_at: string; finished_at: string | null; mode: string; status: string;
  companies_count: number; candidates_count: number; selected_count: number; failures_count: number;
};
type DashboardData = {
  runs: Run[]; contacts: Contact[];
  status: { amo: boolean; github: boolean; supabase: boolean; auto_apply: boolean };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const configured = Boolean(supabaseUrl && supabaseAnonKey);
const supabase = configured ? createClient(supabaseUrl, supabaseAnonKey) : null;
const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Обзор", icon: "⌁" },
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
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
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
  const refresh = useCallback(async () => { setError(""); try { setData(await callAdmin<DashboardData>(session, "/dashboard")); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setLoading(false); } }, [session]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const decide = async (id: number, decision: Decision) => { setBusy(`contact-${id}`); try { await callAdmin(session, `/candidates/${id}`, { method: "PATCH", body: JSON.stringify({ decision }) }); setData((current) => current ? { ...current, contacts: current.contacts.map((item) => item.id === id ? { ...item, decision } : item) } : current); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setBusy(""); } };
  const dispatch = async (operation: "research" | "sync-approved") => { setBusy(operation); try { await callAdmin(session, "/dispatch", { method: "POST", body: JSON.stringify({ operation, max_companies: 10 }) }); setTimeout(() => void refresh(), 1800); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)); } finally { setBusy(""); } };
  const filteredContacts = useMemo(() => (data?.contacts ?? []).filter((item) => filter === "all" || item.decision === filter), [data, filter]);
  const pending = data?.contacts.filter((item) => item.decision === "pending").length ?? 0;
  const approved = data?.contacts.filter((item) => item.decision === "approved" && !item.synced_at).length ?? 0;
  const latest = data?.runs[0];

  return <div className="app-shell"><aside className="sidebar"><div className="logo-row"><Brand compact /><div><strong>Anix</strong><small>Contact Search</small></div></div><nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><i>{item.icon}</i>{item.label}{item.id === "contacts" && pending > 0 && <em>{pending}</em>}</button>)}</nav><div className="sidebar-foot"><span className={data?.status.github ? "status-dot online" : "status-dot"}></span><div><strong>Система {data?.status.github ? "работает" : "не настроена"}</strong><small>{latest ? `Запуск ${formatDate(latest.finished_at)}` : "Запусков пока нет"}</small></div></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">КОНТУР ПРОДАЖ</p><h1>{navItems.find((item) => item.id === view)?.label}</h1></div><div className="top-actions"><button className="ghost-button" onClick={() => void refresh()}>↻ Обновить</button><button className="primary-button small" disabled={Boolean(busy)} onClick={() => void dispatch("research")}>{busy === "research" ? "Запускаем…" : "Найти контакты"}<span>→</span></button><button className="user-button" title={session.user.email ?? ""}>{session.user.email?.[0]?.toUpperCase()}</button></div></header>
      {error && <div className="error-banner"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
      {loading ? <div className="loading-grid"><i></i><i></i><i></i></div> : <>
        {view === "overview" && <section className="view-stack"><div className="stats-grid"><StatCard label="Ждут решения" value={pending} foot="найденных контактов" tone="accent" /><StatCard label="Готовы к AmoCRM" value={approved} foot="одобрены, не отправлены" /><StatCard label="Компаний за запуск" value={latest?.companies_count ?? 0} foot={latest ? formatDate(latest.finished_at) : "нет запусков"} /><StatCard label="Ошибок" value={latest?.failures_count ?? 0} foot="в последнем запуске" tone={(latest?.failures_count ?? 0) > 0 ? "danger" : ""} /></div>
          <div className="overview-grid"><section className="panel queue-panel"><div className="panel-head"><div><p className="eyebrow">ПРИОРИТЕТ</p><h2>Контакты на проверку</h2></div><button className="text-button" onClick={() => setView("contacts")}>Открыть все →</button></div>{(data?.contacts ?? []).filter((item) => item.decision === "pending").slice(0, 4).map((contact) => <div className="contact-row" key={contact.id}><div className="avatar">{initials(contact.full_name, contact.company_name)}</div><div className="contact-main"><strong>{contact.full_name || contact.emails[0]?.value || "Общий контакт"}</strong><span>{contact.position || contact.company_name}</span></div><div className="score">{contact.score}</div><div className="row-actions"><button onClick={() => void decide(contact.id, "rejected")}>×</button><button className="approve" onClick={() => void decide(contact.id, "approved")}>✓</button></div></div>)}{pending === 0 && <Empty icon="⌁" title="Очередь пуста" text="Запустите поиск — новые контакты появятся здесь." />}</section>
            <section className="panel run-panel"><div className="panel-head"><div><p className="eyebrow">АВТОМАТИЗАЦИЯ</p><h2>Еженедельный цикл</h2></div><span className="live-pill">ПН · 09:00</span></div><div className="run-flow"><Flow n="1" title="AmoCRM" text="Компании из очереди" done /><div className="flow-line"></div><Flow n="2" title="OSINT-поиск" text="Сайт, Tavily, Hunter" done /><div className="flow-line"></div><Flow n="3" title="Ваше решение" text="Одобрить или отклонить" /></div><button className="primary-button full" disabled={approved === 0 || Boolean(busy)} onClick={() => void dispatch("sync-approved")}>{busy === "sync-approved" ? "Отправляем…" : `Отправить одобренные в AmoCRM (${approved})`}<span>→</span></button></section></div></section>}
        {view === "contacts" && <section className="view-stack"><div className="toolbar"><div className="segmented">{(["pending", "approved", "rejected", "all"] as const).map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item === "pending" ? "Новые" : item === "approved" ? "Одобрены" : item === "rejected" ? "Отклонены" : "Все"}</button>)}</div><button className="primary-button small" disabled={approved === 0 || Boolean(busy)} onClick={() => void dispatch("sync-approved")}>В AmoCRM · {approved}</button></div><div className="contact-grid">{filteredContacts.map((contact) => <ContactCard key={contact.id} contact={contact} busy={busy === `contact-${contact.id}`} decide={decide} />)}{filteredContacts.length === 0 && <div className="empty-state wide"><div>◉</div><strong>Здесь пока пусто</strong><span>Для этого фильтра контактов нет.</span></div>}</div></section>}
        {view === "runs" && <section className="panel runs-table"><div className="panel-head"><div><p className="eyebrow">ЖУРНАЛ</p><h2>История запусков</h2></div></div><div className="table-head"><span>Запуск</span><span>Режим</span><span>Компании</span><span>Найдено</span><span>Ошибки</span><span>Статус</span></div>{(data?.runs ?? []).map((run) => <div className="table-row" key={run.id}><span><strong>{formatDate(run.started_at)}</strong><small>{run.id.slice(0, 10)}</small></span><span>{run.mode}</span><span>{run.companies_count}</span><span>{run.selected_count}</span><span>{run.failures_count}</span><span><b className={`run-status ${run.status}`}>{run.status}</b></span></div>)}{(data?.runs ?? []).length === 0 && <Empty icon="↻" title="Запусков ещё нет" text="Первый dry-run создаст запись в журнале." />}</section>}
        {view === "settings" && <section className="settings-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">ИНТЕГРАЦИИ</p><h2>Состояние системы</h2></div></div><div className="integration-list">{[["AmoCRM", data?.status.amo, "Сделки, контакты и задачи"], ["GitHub Actions", data?.status.github, "Поиск и деплой"], ["Supabase", data?.status.supabase, "Доступ и история"]].map(([name, active, detail]) => <div key={String(name)}><span className={active ? "integration-icon active" : "integration-icon"}>{String(name)[0]}</span><span><strong>{String(name)}</strong><small>{String(detail)}</small></span><b className={active ? "connected" : "disconnected"}>{active ? "Подключено" : "Не настроено"}</b></div>)}</div></section><section className="panel settings-copy"><p className="eyebrow">РЕЖИМ</p><h2>{data?.status.auto_apply ? "Автоприменение включено" : "Ручное одобрение"}</h2><p>Контакт попадает в AmoCRM только после проверки в этой панели. Это защищает базу от дублей и нерелевантных адресов.</p><div className="safe-badge">✓ Безопасный режим</div><button className="ghost-button full" onClick={() => void supabase?.auth.signOut()}>Выйти из панели</button></section></section>}
      </>}
    </main></div>;
}

function Flow({ n, title, text, done = false }: { n: string; title: string; text: string; done?: boolean }) { return <div className={`flow-step ${done ? "done" : ""}`}><i>{n}</i><span><b>{title}</b><small>{text}</small></span></div>; }
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><span>{text}</span></div>; }
function ContactCard({ contact, busy, decide }: { contact: Contact; busy: boolean; decide: (id: number, decision: Decision) => Promise<void> }) { return <article className="contact-card"><div className="card-top"><div className="avatar large">{initials(contact.full_name, contact.company_name)}</div><div><p className="company-label">{contact.company_name}</p><h3>{contact.full_name || "Общий контакт"}</h3><span>{contact.position || "Должность не указана"}</span></div><div className="score-ring"><strong>{contact.score}</strong><small>/100</small></div></div><div className="channel-list">{contact.emails.slice(0, 2).map((email) => <a href={`mailto:${email.value}`} key={email.value}><i>@</i><span>{email.value}<small>{email.deliverability === "deliverable" ? "Проверен" : email.generic ? "Общий" : "Не проверен"}</small></span></a>)}{contact.phones.slice(0, 1).map((phone) => <a href={`tel:${phone}`} key={phone}><i>☎</i><span>{phone}<small>Телефон</small></span></a>)}</div><div className="evidence-row"><span>{contact.evidence.length} источника</span><div>{contact.evidence.slice(0, 3).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title}>{source.source[0]?.toUpperCase()}</a>)}</div></div><div className="card-actions"><button className={contact.decision === "rejected" ? "selected reject" : "reject"} disabled={busy} onClick={() => void decide(contact.id, "rejected")}>Отклонить</button><button className={contact.decision === "approved" ? "selected accept" : "accept"} disabled={busy} onClick={() => void decide(contact.id, "approved")}>{contact.synced_at ? "В AmoCRM ✓" : "Одобрить"}</button></div></article>; }

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(configured);
  useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); }); const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)); return () => data.subscription.unsubscribe(); }, []);
  if (!configured) return <SetupScreen />;
  if (checking) return <main className="auth-shell"><div className="loader"></div></main>;
  if (!session) return <SignIn />;
  return <App session={session} />;
}
