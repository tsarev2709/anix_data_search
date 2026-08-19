export function companyQueryMatrix(companyName: string, targetRoles: string[]): string[] {
  const company = `"${companyName}"`;
  const roles = targetRoles.slice(0, 8).map((role) => `"${role}"`).join(" OR ");
  return [
    `${company} официальный сайт контакты`,
    `${company} руководство директор ${roles ? `(${roles})` : ""}`.trim(),
    `${company} email телефон`,
    `${company} интервью вебинар конференция`,
    `${company} назначен назначена руководитель`,
    `${company} site:t.me OR site:vk.com`,
    `${company} site:youtube.com OR site:rutube.ru`,
    `${company} site:threads.net OR site:instagram.com`,
    `${company} site:tenchat.ru OR site:linkedin.com`,
    `${company} Telegram OR ВКонтакте OR TenChat`,
  ];
}

export function personQueryMatrix(personName: string, companyName: string): string[] {
  const person = `"${personName}"`;
  const company = `"${companyName}"`;
  return [
    `${person} ${company}`,
    `${person} ${company} email`,
    `${person} ${company} Telegram`,
    `${person} ${company} site:t.me OR site:vk.com`,
    `${person} ${company} site:tenchat.ru OR site:linkedin.com`,
    `${person} ${company} site:threads.net OR site:instagram.com`,
    `${person} ${company} интервью OR конференция OR вебинар`,
    `${person} ${company} site:youtube.com`,
  ];
}
