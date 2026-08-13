const GENERIC_LOCAL_PARTS = new Set([
  "admin",
  "contact",
  "contacts",
  "hello",
  "help",
  "info",
  "mail",
  "marketing",
  "office",
  "press",
  "sales",
  "secretary",
  "support",
  "team",
]);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/^mailto:/, "").split(/[?#]/, 1)[0] ?? "";
}

export function isGenericEmail(value: string): boolean {
  const local = normalizeEmail(value).split("@", 1)[0] ?? "";
  return GENERIC_LOCAL_PARTS.has(local) || /^(info|office|mail|hello|contact|sales)[._-]/.test(local);
}

export function normalizePhone(value: string): string {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  return `${hasPlus ? "+" : ""}${digits}`;
}

export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function domainFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

export function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[|\r\n]+/g, " ").trim();
}

export function safeFilenameDate(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}
