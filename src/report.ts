import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContactCandidate, RunReport } from "./types.js";
import { escapeMarkdown, safeFilenameDate } from "./utils.js";

function candidateName(candidate: ContactCandidate): string {
  return candidate.fullName || candidate.emails[0]?.value || candidate.phones[0] || candidate.socialUrls[0] || "—";
}

export function renderMarkdown(report: RunReport): string {
  const lines = [
    `# Поиск контактов — ${report.finishedAt.slice(0, 10)}`,
    "",
    `Режим: **${report.mode}** · запись: **${report.writeMode}** · запуск: \`${report.runId}\``,
    "",
    `Компаний: ${report.totals.companies} · кандидатов: ${report.totals.candidates} · выбрано: ${report.totals.selected} · выполнено действий: ${report.totals.actionsCompleted} · ошибок: ${report.totals.failures}`,
    "",
    "| Компания | Сайт | Кандидаты | Выбрано | Ошибки |",
    "|---|---|---:|---:|---:|",
    ...report.companies.map((result) => {
      const failures = result.actions.filter((action) => action.status === "failed").length;
      return `| ${escapeMarkdown(result.company.companyName)} | ${result.discoveredWebsite ? `[открыть](${result.discoveredWebsite})` : "—"} | ${result.candidates.length} | ${result.selectedCandidates.length} | ${failures} |`;
    }),
    "",
  ];

  for (const result of report.companies) {
    lines.push(`## ${result.company.companyName}`, "");
    lines.push(`Исходная сделка: #${result.company.sourceLeadId} · ${Math.round(result.durationMs / 100) / 10} сек.`, "");
    if (result.selectedCandidates.length > 0) {
      lines.push("| Контакт | Должность | Каналы | Балл |", "|---|---|---|---:|");
      for (const candidate of result.selectedCandidates) {
        const channels = [...candidate.emails.map((email) => email.value), ...candidate.phones, ...candidate.socialUrls].join("<br>");
        lines.push(`| ${escapeMarkdown(candidateName(candidate))} | ${escapeMarkdown(candidate.position ?? "—")} | ${escapeMarkdown(channels)} | ${candidate.score} |`);
      }
      lines.push("");
    } else {
      lines.push("Подходящих контактов нет.", "");
    }
    if (result.warnings.length > 0) {
      lines.push("Предупреждения:", "", ...result.warnings.map((item) => `- ${item}`), "");
    }
    if (result.actions.length > 0) {
      lines.push("Действия:", "", ...result.actions.map((action) => `- ${action.status}: ${action.type} — ${action.detail}`), "");
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function writeReport(report: RunReport, directory = "reports"): Promise<void> {
  await mkdir(directory, { recursive: true });
  const markdown = renderMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const suffix = safeFilenameDate(report.finishedAt);
  await Promise.all([
    writeFile(path.join(directory, `report-${suffix}.md`), markdown, "utf8"),
    writeFile(path.join(directory, `report-${suffix}.json`), json, "utf8"),
    writeFile(path.join(directory, "latest.md"), markdown, "utf8"),
    writeFile(path.join(directory, "latest.json"), json, "utf8"),
  ]);
}
