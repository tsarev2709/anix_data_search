export function validInn(value: unknown): string | null {
  const digits = String(value ?? "").trim();
  if (!/^(?:\d{10}|\d{12})$/.test(digits) || /^0+$/.test(digits)) return null;
  const checksum = (weights: number[]) => weights.reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0) % 11 % 10;
  if (digits.length === 10) return checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(digits[9]) ? digits : null;
  return checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(digits[10])
    && checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(digits[11]) ? digits : null;
}

export function normalizedCompanyName(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[«»"'“”]/g, " ")
    .replace(/(?:^|\s)(?:ооо|пао|оао|зао|ао|ип)(?=\s|$)/g, " ").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

/** Use a unique valid INN next to this company's name on its crawled site. */
export function officialCompanyInn(pages: Array<{ url: string; text: string }>, companyName: string): { inn: string; sourceUrl: string } | null {
  const name = normalizedCompanyName(companyName);
  if (name.length < 3) return null;
  const candidates = pages.flatMap((page) => [...page.text.matchAll(/(?:^|[^a-zа-яё0-9])ИНН\s*[:：]?\s*(\d{10,12})(?!\d)/gi)]
    .flatMap((match) => {
      const inn = validInn(match[1]);
      const context = normalizedCompanyName(page.text.slice(Math.max(0, match.index - 180), match.index + 180));
      return inn && ` ${context} `.includes(` ${name} `) ? [{ inn, sourceUrl: page.url }] : [];
    }));
  return new Set(candidates.map((candidate) => candidate.inn)).size === 1 ? candidates[0]! : null;
}
