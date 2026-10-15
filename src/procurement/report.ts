import type { ProcurementResearch } from "./types.js";
import { escapeMarkdown } from "../utils.js";

export const procurementRoleLabels = { customer: "Заказчик", supplier: "Участник / поставщик", winner: "Победитель", claimant: "Истец / заявитель", defendant: "Ответчик", unknown: "Роль не установлена" };
export const procurementStatusLabels = { active: "Текущая процедура", completed: "Завершена", failed: "Не состоялась", cancelled: "Отменена", unknown: "Статус не установлен" };

export function renderProcurementMarkdown(research: ProcurementResearch): string[] {
  const s = research.summary;
  const lines = ["### Закупки и арбитражи", "",
    `Проверка: ${research.checkedAt} · ИНН: ${research.inn ?? "не указан"} · охват: ${research.status}.`,
    `Источник ИНН: ${research.innSource ?? "не установлен"}.`,
    `Подтверждённых закупок: ${s.confirmedProcurements} · заказчик: ${s.customer} · участник/поставщик: ${s.supplier} · победитель: ${s.winner}.`,
    `Текущих: ${s.active} · завершённых: ${s.completed} · несостоявшихся: ${s.failed} · отменённых: ${s.cancelled}.`,
    `Подтверждённых судебных дел: ${s.confirmedCases} · со связью по реквизиту закупки/договора: ${s.linkedCases} · кандидатов на проверку: ${s.candidates} · ссылок на ТЗ: ${s.specificationLinks}.`,
    "Числа относятся к найденной выборке. Ноль не подтверждает отсутствие торгов или споров.", ""];
  for (const record of research.records) {
    lines.push(`**[${escapeMarkdown(record.title)}](<${record.url}>)**`,
      `${record.kind === "arbitration" ? "Судебное дело" : "Закупка"} · ${record.number ?? "номер не установлен"} · ${record.verification === "confirmed" ? "подтверждено по ИНН и роли" : "кандидат, требуется проверка"} · ${record.authority === "primary" ? "первичный источник" : "вторичный источник"}.`,
      `${procurementRoleLabels[record.role]} · ${procurementStatusLabels[record.status]} · предмет: ${escapeMarkdown(record.subject ?? "не извлечён")}.`,
      `Сумма: ${escapeMarkdown(record.amount ?? "не извлечена")} · срок подачи: ${escapeMarkdown(record.deadline ?? "не извлечён")}.`,
      ...record.parties.map((party) => `${escapeMarkdown(party.role)}: ${escapeMarkdown(party.description)}`),
      ...(record.outcome ? [`Исход по источнику: ${escapeMarkdown(record.outcome)}.`] : []),
      `Свидетельство: ${escapeMarkdown(record.evidence)}`, "");
    if (record.relationEvidence) lines.push(record.relationEvidence, ...record.relatedProcurementUrls.map((url) => `- [Связанная закупка](<${url}>)`), "");
    if (record.documents.length) lines.push(...record.documents.map((document) => `- [${escapeMarkdown(document.title)}](<${document.url}>) · ${document.kind} · [карточка-источник](<${document.sourceUrl}>)`), "");
    else lines.push(record.documentsAccess === "restricted" ? "Документация требует входа на площадку; ссылка на карточку приведена выше." : "Прямые ссылки на документы не найдены или карточка не прочитана.", "");
  }
  lines.push("Следующие действия:", ...s.nextActions.map((action) => `- ${action}`), "");
  if (research.warnings.length) lines.push("Ограничения источников:", ...research.warnings.map((warning) => `- ${escapeMarkdown(warning)}`), "");
  lines.push("Запросы закупочной разведки:", ...research.queries.map((query) => `- ${escapeMarkdown(query)}`), "");
  return lines;
}
