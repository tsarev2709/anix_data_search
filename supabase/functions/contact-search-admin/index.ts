import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type AuthUser = { id: string; email?: string | null };
type AuthorizationResult = {
  user: AuthUser | null;
  reason?: "missing_token" | "invalid_session" | "missing_email" | "email_not_allowed";
  email?: string;
};
type GitHubStep = { name?: string; status?: string; conclusion?: string | null; number?: number };
type GitHubJob = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string;
  steps?: GitHubStep[];
};
type GitHubRun = {
  id?: number;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string | null;
  html_url?: string;
  run_number?: number;
};
type TelegramUser = { id?: number; first_name?: string; last_name?: string; username?: string };
type TelegramChat = { id: number; type?: string; title?: string; username?: string };
type TelegramForwardOrigin = {
  type?: string;
  date?: number;
  message_id?: number;
  sender_user?: TelegramUser;
  sender_user_name?: string;
  chat?: TelegramChat;
};
type TelegramMessage = {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  forward_origin?: TelegramForwardOrigin;
};
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const telegramWebhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const telegramMonitorChatId = Deno.env.get("TELEGRAM_MONITOR_CHAT_ID") ?? "";
const allowedOrigins = (Deno.env.get("DASHBOARD_ORIGINS") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const adminEmails = new Set([
  "studio@anix-ai.pro",
  ...(Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
]);

function cors(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "null",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-expose-headers": "x-request-id",
    vary: "Origin",
  };
}

function response(request: Request, status: number, body: Json, requestId: string): Response {
  return Response.json({ ...body, request_id: requestId }, { status, headers: { ...cors(request), "x-request-id": requestId } });
}

function githubHeaders(token: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "anix-contact-search-admin",
    "x-github-api-version": "2022-11-28",
  };
}

async function githubErrorMessage(result: Response): Promise<string> {
  const body = await result.json().catch(() => ({})) as { message?: string };
  return body.message?.slice(0, 500) || `GitHub API вернул HTTP ${result.status}`;
}

async function workflowSnapshot(): Promise<Json> {
  const token = Deno.env.get("GITHUB_ACTIONS_TOKEN") ?? "";
  const repository = Deno.env.get("GITHUB_REPO") ?? "";
  if (!token || !repository) {
    return { configured: false, available: false, error: { code: "github_not_configured", stage: "dispatch", message: "GitHub Actions не подключён" } };
  }

  const runsResponse = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/contact-search.yml/runs?per_page=5`,
    { headers: githubHeaders(token) },
  );
  if (!runsResponse.ok) {
    return {
      configured: true,
      available: false,
      error: { code: "github_runs_unavailable", stage: "workflow_runs", message: await githubErrorMessage(runsResponse), http_status: runsResponse.status },
    };
  }

  const runsPayload = await runsResponse.json() as { workflow_runs?: GitHubRun[] };
  const run = runsPayload.workflow_runs?.[0];
  if (!run?.id) return { configured: true, available: true, latest: null };

  const jobsResponse = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${run.id}/jobs?per_page=20`, {
    headers: githubHeaders(token),
  });
  let jobs: GitHubJob[] = [];
  let jobsError: Json | null = null;
  if (jobsResponse.ok) {
    const jobsPayload = await jobsResponse.json() as { jobs?: GitHubJob[] };
    jobs = jobsPayload.jobs ?? [];
  } else {
    jobsError = {
      code: "github_jobs_unavailable",
      stage: "workflow_jobs",
      message: await githubErrorMessage(jobsResponse),
      http_status: jobsResponse.status,
    };
  }

  const steps = jobs.flatMap((job) => (job.steps ?? []).map((step) => ({
    name: step.name ?? "Без названия",
    status: step.status ?? "unknown",
    conclusion: step.conclusion ?? null,
    number: step.number ?? 0,
  })));
  const failedStep = steps.find((step) => step.conclusion === "failure");
  const activeStep = steps.find((step) => step.status === "in_progress");
  const completedSteps = steps.filter((step) => step.status === "completed");
  const currentStep = failedStep ?? activeStep ?? completedSteps.at(-1) ?? null;

  return {
    configured: true,
    available: true,
    latest: {
      id: run.id,
      run_number: run.run_number ?? null,
      status: run.status ?? "unknown",
      conclusion: run.conclusion ?? null,
      created_at: run.created_at ?? null,
      updated_at: run.updated_at ?? null,
      started_at: run.run_started_at ?? null,
      url: run.html_url ?? null,
      current_step: currentStep?.name ?? (run.status === "queued" ? "Ожидание свободного runner" : null),
      steps,
      jobs: jobs.map((job) => ({
        id: job.id ?? null,
        name: job.name ?? "Без названия",
        status: job.status ?? "unknown",
        conclusion: job.conclusion ?? null,
        started_at: job.started_at ?? null,
        completed_at: job.completed_at ?? null,
        url: job.html_url ?? null,
      })),
    },
    jobs_error: jobsError,
  };
}


function telegramUserName(user?: TelegramUser): string | null {
  if (!user) return null;
  const display = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return user.username ? `${display || user.username} (@${user.username})` : display || null;
}

function telegramOrigin(message: TelegramMessage): { author: string | null; url: string } {
  const origin = message.forward_origin;
  const originChat = origin?.chat;
  const author =
    telegramUserName(origin?.sender_user) ??
    origin?.sender_user_name ??
    originChat?.title ??
    (originChat?.username ? `@${originChat.username}` : null) ??
    telegramUserName(message.from) ??
    message.sender_chat?.title ??
    null;
  if (originChat?.username && origin.message_id) {
    return { author, url: `https://t.me/${originChat.username}/${origin.message_id}` };
  }
  const directUrl = `${message.text ?? ""} ${message.caption ?? ""}`.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
  if (directUrl) return { author, url: directUrl.replace(/[.,;!?]+$/, "") };
  const internalChat = String(message.chat.id).replace(/^-100/, "");
  return { author, url: internalChat ? `https://t.me/c/${internalChat}/${message.message_id}` : "https://t.me" };
}

function telegramClassification(text: string): { category: string; intent: string; fit: string[] } {
  const value = text.toLowerCase();
  const categories: Array<[string, RegExp]> = [
    ["обучающее видео", /обучающ|инструктаж|курс|онбординг|обучить|объясняющ/],
    ["охрана труда и промышленность", /охран[аы] труда|техник[аи] безопасности|промышленн|производств|завод|инструкци/],
    ["HR и бренд работодателя", /hr|эйчар|бренд работодател|ваканси|сотрудник|корпоративн.*культур/],
    ["продуктовое и рекламное видео", /рекламн|продуктов|промо|презентац|имиджев|бренд.*ролик/],
    ["анимация и инфографика", /анимац|моушн|motion|инфограф|3d|2d/],
    ["съёмка события и трансляция", /трансляц|стрим|конференц|форум|мероприят|репортаж/],
    ["фарма и медицина", /фарм|медицин|клиник|врач|пациент/],
    ["видеопродакшн", /видео|ролик|съ[её]м|монтаж|продакшн|видеограф|оператор/],
  ];
  const fit = categories.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  let intent = "market_signal";
  if (/тендер|закупк|котиров|коммерческ.*предлож|конкурс.*подряд/.test(value)) intent = "tender";
  else if (/порекомендуйте|посоветуйте|кто.*делал|ищу рекомендац/.test(value)) intent = "recommendation";
  else if (/ищем|ищу|нужен|нужна|нужны|требуется|подрядчик|исполнитель|агентств|студи[яю]|продакшн/.test(value)) intent = "vendor_search";
  else if (/тз|техническ.*задан|бриф|смет|бюджет|срок|рассчитать/.test(value)) intent = "brief";
  else if (/проблем|не понимаем|не знаем|не получается|надо объяснить|сложно обучить/.test(value)) intent = "problem";
  return { category: fit[0] ?? "видеоконтент для бизнеса", intent, fit };
}

function extractTelegramContacts(text: string): { emails: string[]; phones: string[]; socialUrls: string[] } {
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => value.toLowerCase()))];
  const phones = [...new Set((text.match(/(?:\+7|8)[\s()\-\d]{9,18}\d/g) ?? []).map((value) => value.replace(/[^+\d]/g, "")))];
  const socialUrls = [...new Set(text.match(/https?:\/\/(?:t\.me|vk\.com|tenchat\.ru|linkedin\.com|threads\.net|youtube\.com|youtu\.be)\/[^\s<>"')]+/gi) ?? [])];
  return { emails, phones, socialUrls };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ingestTelegramUpdate(
  request: Request,
  admin: ReturnType<typeof createClient>,
  requestId: string,
): Promise<Response> {
  if (!telegramWebhookSecret) {
    return response(request, 503, { error: "Telegram webhook не настроен", code: "telegram_not_configured", stage: "telegram_configuration" }, requestId);
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== telegramWebhookSecret) {
    return response(request, 401, { error: "Некорректный Telegram webhook secret", code: "telegram_secret_invalid", stage: "telegram_authorization" }, requestId);
  }
  const update = await request.json().catch(() => null) as TelegramUpdate | null;
  const message = update?.message ?? update?.channel_post ?? update?.edited_message ?? update?.edited_channel_post;
  const text = (message?.text ?? message?.caption ?? "").trim();
  if (!message || !text) {
    return response(request, 200, { ok: true, accepted: false, reason: "empty_or_unsupported_update" }, requestId);
  }
  if (telegramMonitorChatId && String(message.chat.id) !== telegramMonitorChatId) {
    return response(request, 200, { ok: true, accepted: false, reason: "unexpected_chat" }, requestId);
  }

  const origin = telegramOrigin(message);
  const classification = telegramClassification(text);
  const contacts = extractTelegramContacts(text);
  const publishedAt = message.forward_origin?.date ?? message.date;
  const scoreReasons: string[] = ["+15 сигнал из TgNinja"];
  let score = 15;
  if (classification.fit.length > 0) { score += 20; scoreReasons.push("+20 соответствует услугам Anix"); }
  if (["vendor_search", "recommendation", "brief"].includes(classification.intent)) { score += 35; scoreReasons.push("+35 явное намерение найти решение"); }
  if (classification.intent === "tender") { score += 45; scoreReasons.push("+45 тендер или закупка"); }
  if (contacts.emails.length > 0) { score += 15; scoreReasons.push("+15 указан email"); }
  if (contacts.phones.length > 0) { score += 10; scoreReasons.push("+10 указан телефон"); }
  const fingerprint = await sha256(`telegram_ninja|${origin.url}|${message.message_id}|${text.slice(0, 500)}`);
  const { error } = await admin.from("demand_signals").upsert({
    fingerprint,
    last_run_id: null,
    source: "telegram_ninja",
    category: classification.category,
    intent: classification.intent,
    query: classification.fit.join(" · ") || "TgNinja monitoring",
    title: text.replace(/\s+/g, " ").slice(0, 180),
    url: origin.url,
    snippet: text.slice(0, 4000),
    author: origin.author,
    published_at: publishedAt ? new Date(publishedAt * 1000).toISOString() : null,
    last_seen_at: new Date().toISOString(),
    score: Math.min(100, score),
    score_reasons: scoreReasons,
    emails: contacts.emails,
    phones: contacts.phones,
    social_urls: contacts.socialUrls,
  }, { onConflict: "fingerprint" });
  if (error) {
    console.error("Telegram signal storage failed", { requestId, message: error.message });
    return response(request, 500, { error: error.message, code: "telegram_storage_failed", stage: "telegram_storage" }, requestId);
  }
  console.log("Telegram signal accepted", { requestId, fingerprint, chatId: message.chat.id, score: Math.min(100, score) });
  return response(request, 200, { ok: true, accepted: true, fingerprint, score: Math.min(100, score), source: "telegram_ninja" }, requestId);
}

async function authorize(request: Request): Promise<AuthorizationResult> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { user: null, reason: "missing_token" };

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });
  if (!authResponse.ok) {
    console.warn("Dashboard authorization rejected by Supabase Auth", { status: authResponse.status });
    return { user: null, reason: "invalid_session" };
  }

  const user = await authResponse.json() as AuthUser;
  const email = user.email?.trim().toLowerCase();
  if (!email) return { user: null, reason: "missing_email" };
  if (!adminEmails.has(email)) return { user: null, reason: "email_not_allowed", email };
  return { user, email };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers: { ...cors(request), "x-request-id": requestId } });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response(request, 503, { error: "Supabase function secrets are incomplete", code: "supabase_secrets_incomplete", stage: "configuration" }, requestId);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const pathname = new URL(request.url).pathname;
  if (request.method === "POST" && pathname.endsWith("/telegram-webhook")) {
    return ingestTelegramUpdate(request, admin, requestId);
  }

  const authorization = await authorize(request);
  if (!authorization.user) {
    const wrongEmail = authorization.reason === "email_not_allowed" && authorization.email;
    return response(request, 403, {
      error: wrongEmail
        ? `Аккаунт ${wrongEmail} не входит в список администраторов`
        : "Сессия не прошла проверку Supabase Auth. Выйдите из панели и войдите снова.",
      code: authorization.reason ?? "authorization_failed",
      signed_in_as: authorization.email ?? null,
      stage: "authorization",
    }, requestId);
  }

  if (request.method === "GET" && pathname.endsWith("/dashboard")) {
    const [runsResult, companiesResult, contactsResult, demandRunsResult, demandSignalsResult, workflow] = await Promise.all([
      admin.from("contact_search_runs").select("*").order("started_at", { ascending: false }).limit(50),
      admin
        .from("contact_search_companies")
        .select("id,run_id,source_lead_id,source_lead_name,source_company_id,company_name,source_website,website,company_context,research_trace,candidates,selected_candidates,actions,warnings,duration_ms,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("contact_search_candidates")
        .select("id,company_name,source_lead_id,full_name,position,emails,phones,social_urls,score,score_reasons,evidence,decision,synced_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      admin.from("demand_monitor_runs").select("*").order("started_at", { ascending: false }).limit(30),
      admin
        .from("demand_signals")
        .select("id,fingerprint,last_run_id,source,category,intent,query,title,url,snippet,author,published_at,first_seen_at,last_seen_at,score,score_reasons,emails,phones,social_urls,status")
        .order("score", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(300),
      workflowSnapshot(),
    ]);
    if (runsResult.error || companiesResult.error || contactsResult.error || demandRunsResult.error || demandSignalsResult.error) {
      return response(request, 500, {
        error: runsResult.error?.message ?? companiesResult.error?.message ?? contactsResult.error?.message ?? demandRunsResult.error?.message ?? demandSignalsResult.error?.message ?? "Query failed",
        code: "dashboard_storage_query_failed",
        stage: "supabase_read",
      }, requestId);
    }
    return response(request, 200, {
      runs: runsResult.data,
      companies: companiesResult.data,
      contacts: contactsResult.data,
      demand_runs: demandRunsResult.data,
      demand_signals: demandSignalsResult.data,
      workflow,
      status: {
        amo: Boolean(Deno.env.get("AMO_CONFIGURED")),
        github: Boolean(Deno.env.get("GITHUB_ACTIONS_TOKEN") && Deno.env.get("GITHUB_REPO")),
        supabase: true,
        auto_apply: Deno.env.get("AUTO_APPLY") === "true",
        telegram_ninja: Boolean(telegramWebhookSecret),
      },
      diagnostics: {
        generated_at: new Date().toISOString(),
        storage: { runs: "ok", companies: "ok", contacts: "ok", demand_runs: "ok", demand_signals: "ok" },
        workflow: (workflow as { available?: boolean }).available ? "ok" : "unavailable",
      },
    }, requestId);
  }

  const candidateMatch = pathname.match(/\/candidates\/(\d+)$/);
  if (request.method === "PATCH" && candidateMatch) {
    const body = await request.json().catch(() => ({})) as { decision?: string };
    if (!body.decision || !["pending", "approved", "rejected"].includes(body.decision)) {
      return response(request, 400, { error: "Некорректное решение", code: "invalid_decision", stage: "candidate_update" }, requestId);
    }
    const { error } = await admin.from("contact_search_candidates").update({ decision: body.decision }).eq("id", Number(candidateMatch[1])).is("synced_at", null);
    if (error) return response(request, 500, { error: error.message, code: "candidate_update_failed", stage: "supabase_write" }, requestId);
    return response(request, 200, { ok: true, stage: "candidate_updated" }, requestId);
  }

  const demandMatch = pathname.match(/\/demand-signals\/(\d+)$/);
  if (request.method === "PATCH" && demandMatch) {
    const body = await request.json().catch(() => ({})) as { status?: string };
    if (!body.status || !["new", "qualified", "dismissed"].includes(body.status)) {
      return response(request, 400, { error: "Некорректный статус сигнала", code: "invalid_demand_status", stage: "demand_update" }, requestId);
    }
    const { error } = await admin.from("demand_signals").update({ status: body.status }).eq("id", Number(demandMatch[1]));
    if (error) return response(request, 500, { error: error.message, code: "demand_update_failed", stage: "supabase_write" }, requestId);
    return response(request, 200, { ok: true, stage: "demand_updated" }, requestId);
  }

  if (request.method === "POST" && pathname.endsWith("/dispatch")) {
    const body = await request.json().catch(() => ({})) as { operation?: string; max_companies?: number; company_name?: string; company_website?: string };
    if (!body.operation || !["research", "research-company", "monitor-demand", "sync-approved"].includes(body.operation)) {
      return response(request, 400, { error: "Некорректная операция", code: "invalid_operation", stage: "dispatch_validation" }, requestId);
    }
    if (body.operation === "research-company" && !body.company_name?.trim()) {
      return response(request, 400, { error: "Укажите название компании", code: "company_name_required", stage: "dispatch_validation" }, requestId);
    }
    const githubToken = Deno.env.get("GITHUB_ACTIONS_TOKEN") ?? "";
    const repository = Deno.env.get("GITHUB_REPO") ?? "";
    if (!githubToken || !repository) {
      return response(request, 503, { error: "GitHub Actions не подключён", code: "github_not_configured", stage: "dispatch_configuration" }, requestId);
    }
    const requestedAt = new Date().toISOString();
    const maxCompanies = Math.min(250, Math.max(1, body.max_companies ?? 10));
    const dispatchResponse = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/contact-search.yml/dispatches`, {
      method: "POST",
      headers: githubHeaders(githubToken),
      body: JSON.stringify({
        ref: "main",
        inputs: {
          operation: body.operation,
          mode: body.operation === "sync-approved" ? "apply" : "dry-run",
          max_companies: String(maxCompanies),
          company_name: body.company_name?.trim() ?? "",
          company_website: body.company_website?.trim() ?? "",
        },
      }),
    });
    if (!dispatchResponse.ok) {
      return response(request, 502, {
        error: await githubErrorMessage(dispatchResponse),
        code: "github_dispatch_failed",
        stage: "github_dispatch",
        http_status: dispatchResponse.status,
      }, requestId);
    }
    return response(request, 202, {
      ok: true,
      dispatch: {
        status: "accepted",
        operation: body.operation,
        mode: body.operation === "sync-approved" ? "apply" : "dry-run",
        max_companies: maxCompanies,
        company_name: body.company_name?.trim() || null,
        company_website: body.company_website?.trim() || null,
        requested_at: requestedAt,
      },
      trace: [
        { stage: "authorization", status: "completed" },
        { stage: "dispatch_validation", status: "completed" },
        { stage: "github_dispatch", status: "accepted" },
      ],
    }, requestId);
  }

  return response(request, 404, { error: "Маршрут не найден", code: "route_not_found", stage: "routing" }, requestId);
});
