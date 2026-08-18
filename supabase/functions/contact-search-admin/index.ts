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

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = (Deno.env.get("DASHBOARD_ORIGINS") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const adminEmails = new Set([
  "studio@anix-ai.pro",
  ...(Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
]);

function cors(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "null",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
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
    `https://api.github.com/repos/${repository}/actions/workflows/contact-search.yml/runs?event=workflow_dispatch&per_page=5`,
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

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const pathname = new URL(request.url).pathname;

  if (request.method === "GET" && pathname.endsWith("/dashboard")) {
    const [runsResult, contactsResult, workflow] = await Promise.all([
      admin.from("contact_search_runs").select("*").order("started_at", { ascending: false }).limit(50),
      admin
        .from("contact_search_candidates")
        .select("id,company_name,source_lead_id,full_name,position,emails,phones,social_urls,score,score_reasons,evidence,decision,synced_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      workflowSnapshot(),
    ]);
    if (runsResult.error || contactsResult.error) {
      return response(request, 500, {
        error: runsResult.error?.message ?? contactsResult.error?.message ?? "Query failed",
        code: "dashboard_storage_query_failed",
        stage: "supabase_read",
      }, requestId);
    }
    return response(request, 200, {
      runs: runsResult.data,
      contacts: contactsResult.data,
      workflow,
      status: {
        amo: Boolean(Deno.env.get("AMO_CONFIGURED")),
        github: Boolean(Deno.env.get("GITHUB_ACTIONS_TOKEN") && Deno.env.get("GITHUB_REPO")),
        supabase: true,
        auto_apply: Deno.env.get("AUTO_APPLY") === "true",
      },
      diagnostics: {
        generated_at: new Date().toISOString(),
        storage: { runs: "ok", contacts: "ok" },
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

  if (request.method === "POST" && pathname.endsWith("/dispatch")) {
    const body = await request.json().catch(() => ({})) as { operation?: string; max_companies?: number };
    if (!body.operation || !["research", "sync-approved"].includes(body.operation)) {
      return response(request, 400, { error: "Некорректная операция", code: "invalid_operation", stage: "dispatch_validation" }, requestId);
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
