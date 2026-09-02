import { delay } from "./utils.js";

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  userAgent: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
  }
}

function safeRequestTarget(input: string | URL): string {
  try {
    const url = new URL(String(input));
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|authorization/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  options: HttpOptions,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", options.userAgent);
      const response = await fetch(input, { ...init, headers, signal: controller.signal });
      if ((response.status === 429 || response.status >= 500) && attempt < options.retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) throw error;
      await delay(500 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("HTTP request failed");
}

function safeResponseMessage(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  try {
    const parsed = JSON.parse(compact) as { error?: string | { message?: string }; message?: string; errors?: Array<{ message?: string; details?: string }> };
    const message =
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ??
      parsed.message ??
      parsed.errors?.map((item) => item.message ?? item.details).filter(Boolean).join("; ");
    if (message) return String(message).slice(0, 500);
  } catch {
    // The provider returned text rather than JSON.
  }
  return compact
    .replace(/([?&](?:api_)?key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[\w.-]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

export async function requestJson<T>(
  input: string | URL,
  init: RequestInit,
  options: HttpOptions,
): Promise<T> {
  const response = await fetchWithRetry(input, init, options);
  const body = await response.text();
  if (!response.ok) {
    const detail = safeResponseMessage(body);
    throw new HttpError(`${init.method ?? "GET"} ${safeRequestTarget(input)} returned ${response.status}${detail ? `: ${detail}` : ""}`, response.status, body);
  }
  return body ? (JSON.parse(body) as T) : (undefined as T);
}
