import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type AuthUser = { id: string; email?: string | null };
type AuthorizationResult = {
  user: AuthUser | null;
  reason?: "missing_token" | "invalid_session" | "missing_email" | "email_not_allowed";
  email?: string;
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
    vary: "Origin",
  };
}

function response(request: Request, status: number, body: Json): Response {
  return Response.json(body, { status, headers: cors(request) });
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
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(request, 503, { error: "Supabase function secrets are incomplete" });
  const authorization = await authorize(request);
  if (!authorization.user) {
    const wrongEmail = authorization.reason === "email_not_allowed" && authorization.email;
    return response(request, 403, {
      error: wrongEmail
        ? `Аккаунт ${wrongEmail} не входит в список администраторов`
        : "Сессия не прошла проверку Supabase Auth. Выйдите из панели и войдите снова.",
      code: authorization.reason ?? "authorization_failed",
      signed_in_as: authorization.email ?? null,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const pathname = new URL(request.url).pathname;

  if (request.method === "GET" && pathname.endsWith("/dashboard")) {
    const [runsResult, contactsResult] = await Promise.all([
      admin.from("contact_search_runs").select("*").order("started_at", { ascending: false }).limit(50),
      admin
        .from("contact_search_candidates")
        .select("id,company_name,source_lead_id,full_name,position,emails,phones,social_urls,score,score_reasons,evidence,decision,synced_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (runsResult.error || contactsResult.error) {
      return response(request, 500, { error: runsResult.error?.message ?? contactsResult.error?.message ?? "Query failed" });
    }
    return response(request, 200, {
      runs: runsResult.data,
      contacts: contactsResult.data,
      status: {
        amo: Boolean(Deno.env.get("AMO_CONFIGURED")),
        github: Boolean(Deno.env.get("GITHUB_ACTIONS_TOKEN") && Deno.env.get("GITHUB_REPO")),
        supabase: true,
        auto_apply: Deno.env.get("AUTO_APPLY") === "true",
      },
    });
  }

  const candidateMatch = pathname.match(/\/candidates\/(\d+)$/);
  if (request.method === "PATCH" && candidateMatch) {
    const body = await request.json().catch(() => ({})) as { decision?: string };
    if (!body.decision || !["pending", "approved", "rejected"].includes(body.decision)) {
      return response(request, 400, { error: "Некорректное решение" });
    }
    const { error } = await admin.from("contact_search_candidates").update({ decision: body.decision }).eq("id", Number(candidateMatch[1])).is("synced_at", null);
    if (error) return response(request, 500, { error: error.message });
    return response(request, 200, { ok: true });
  }

  if (request.method === "POST" && pathname.endsWith("/dispatch")) {
    const body = await request.json().catch(() => ({})) as { operation?: string; max_companies?: number };
    if (!body.operation || !["research", "sync-approved"].includes(body.operation)) {
      return response(request, 400, { error: "Некорректная операция" });
    }
    const githubToken = Deno.env.get("GITHUB_ACTIONS_TOKEN") ?? "";
    const repository = Deno.env.get("GITHUB_REPO") ?? "";
    if (!githubToken || !repository) return response(request, 503, { error: "GitHub Actions не подключён" });
    const dispatchResponse = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/contact-search.yml/dispatches`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "content-type": "application/json",
        "user-agent": "anix-contact-search-admin",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          operation: body.operation,
          mode: body.operation === "sync-approved" ? "apply" : "dry-run",
          max_companies: String(Math.min(250, Math.max(1, body.max_companies ?? 10))),
        },
      }),
    });
    if (!dispatchResponse.ok) return response(request, 502, { error: `GitHub ${dispatchResponse.status}: ${await dispatchResponse.text()}` });
    return response(request, 202, { ok: true });
  }

  return response(request, 404, { error: "Маршрут не найден" });
});
