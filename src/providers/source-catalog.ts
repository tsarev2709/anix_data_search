/** Search targets, not a claim that each site's API or full content is accessible. */
export interface SearchSite {
  domain: string;
  group: "social" | "forum" | "procurement" | "industry";
}

export const SEARCH_SITES: readonly SearchSite[] = [
  ...["t.me", "vk.com", "vk.ru", "tenchat.ru", "linkedin.com", "threads.net", "threads.com", "instagram.com", "ok.ru", "facebook.com"]
    .map((domain) => ({ domain, group: "social" as const })),
  ...["vc.ru", "habr.com", "pikabu.ru", "otvet.mail.ru", "reddit.com", "dtf.ru", "searchengines.guru", "forum.klerk.ru"]
    .map((domain) => ({ domain, group: "forum" as const })),
  ...["zakupki.gov.ru", "b2b-center.ru", "fabrikant.ru", "roseltorg.ru", "tender.pro", "tektorg.ru", "etp.gpb.ru"]
    .map((domain) => ({ domain, group: "procurement" as const })),
  ...["pharmvestnik.ru", "gmpnews.ru", "vademec.ru", "medvestnik.ru", "remedium.ru", "sostav.ru", "adindex.ru", "cossa.ru", "e-xecutive.ru", "hh.ru", "companies.rbc.ru"]
    .map((domain) => ({ domain, group: "industry" as const })),
];

/** Interleave groups so small budgets do not spend every query on social networks. */
export function diverseSearchSites(): SearchSite[] {
  const groups = ["social", "forum", "procurement", "industry"] as const;
  const lanes = groups.map((group) => SEARCH_SITES.filter((site) => site.group === group));
  const result: SearchSite[] = [];
  for (let index = 0; lanes.some((lane) => index < lane.length); index += 1) {
    for (const lane of lanes) if (lane[index]) result.push(lane[index]!);
  }
  return result;
}

export function utcDay(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function rotate<T>(items: readonly T[], offset: number): T[] {
  if (!items.length) return [];
  const start = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}
