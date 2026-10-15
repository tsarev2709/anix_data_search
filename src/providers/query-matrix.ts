import { diverseSearchSites, rotate, utcDay } from "./source-catalog.js";

export function companyQueryMatrix(companyName: string, targetRoles: string[], date = new Date()): string[] {
  const company = `"${companyName}"`;
  const roles = targetRoles.slice(0, 8).map((role) => `"${role}"`).join(" OR ");
  return [
    `${company} официальный сайт контакты`,
    `${company} руководство директор ${roles ? `(${roles})` : ""}`.trim(),
    `${company} email телефон`,
    `${company} интервью вебинар конференция`,
    `${company} назначен назначена руководитель`,
    `${company} site:youtube.com OR site:rutube.ru`,
    `${company} filetype:pdf контакты OR спикер OR директор`,
    ...rotate(diverseSearchSites(), utcDay(date)).map((site) => `${company} site:${site.domain}`),
  ];
}

export function personQueryMatrix(personName: string, companyName: string, date = new Date()): string[] {
  const person = `"${personName}"`;
  const company = `"${companyName}"`;
  return [
    `${person} ${company}`,
    `${person} ${company} email`,
    `${person} ${company} Telegram`,
    `${person} ${company} интервью OR конференция OR вебинар`,
    `${person} ${company} site:youtube.com`,
    ...rotate(diverseSearchSites().filter((site) => site.group !== "procurement"), utcDay(date))
      .map((site) => `${person} ${company} site:${site.domain}`),
  ];
}
