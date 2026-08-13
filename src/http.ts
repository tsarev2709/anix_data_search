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

export async function requestJson<T>(
  input: string | URL,
  init: RequestInit,
  options: HttpOptions,
): Promise<T> {
  const response = await fetchWithRetry(input, init, options);
  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(`${init.method ?? "GET"} ${safeRequestTarget(input)} returned ${response.status}`, response.status, body);
  }
  return body ? (JSON.parse(body) as T) : (undefined as T);
}
