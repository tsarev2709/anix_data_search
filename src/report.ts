import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContactCandidate, RunReport } from "./types.js";
import { escapeMarkdown, safeFilenameDate } from "./utils.js";

function candidateName(candidate: ContactCandidate): string {
  return candidate.fullName || candidate.emails[0]?.value || candidate.phones[0] || candidate.socialUrls[0] || "—";
}

function candidateKey(candidate: ContactCandidate): string {
  return candidate.emails[0]?.value ?? candidate.phones[0] ?? candidate.socialUrls[0] ?? `${candidate.fullName ?? ""}|${candidate.position ?? ""}`;
}

export function renderMarkdown(report: RunReport): string {
  const lines = [
    `# Поиск контактов — ${report.finishedAt.slice(0, 10)}`,
    "",
    `Режим: **${report.mode}** · запись: **${report.writeMode}** · запуск: \`${report.runId}\``,
    "",
    `Компаний: ${report.totals.companies} · кандидатов: ${report.totals.candidates} · выбрано: ${report.totals.selected} · выполнено действий: ${report.totals.actionsCompleted} · ошибок: ${report.totals.failures}`,
    `Запросов: ${report.totals.searchQueries} · web-результатов: ${report.totals.searchResults} · страниц: ${report.totals.pagesCrawled} · людей: ${report.totals.peopleFound} · должностей: ${report.totals.positionsFound}`,
    `Email найдено: ${report.totals.emailsFound} · персональных: ${report.totals.personalEmailsFound} · inferred: ${report.totals.inferredEmailsFound} · телефонов: ${report.totals.phonesFound} · Telegram: ${report.totals.telegramFound}`,
    `Соцпрофилей: ${report.totals.socialProfilesFound} (${Object.entries(report.totals.socialByPlatform).map(([platform, count]) => `${platform}: ${count}`).join(", ") || "нет"}) · high/medium/low: ${report.totals.highConfidenceContacts}/${report.totals.mediumConfidenceContacts}/${report.totals.lowConfidenceContacts} · сбоев providers: ${report.totals.providerFailures}`,
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
    lines.push(
      `Исходная сделка: #${result.company.sourceLeadId} «${escapeMarkdown(result.company.sourceLeadName)}» · ${Math.round(result.durationMs / 100) / 10} сек.`,
      `Компания AmoCRM: ${result.company.companyId ? `#${result.company.companyId}` : "не привязана"} · сайт из CRM: ${result.company.website ?? "не указан"}`,
      "",
    );
    lines.push("Поисковые запросы:", "", ...result.research.searchQueries.map((query) => `- ${escapeMarkdown(query)}`), "");
    lines.push(
      `Провайдеры: ${Object.entries(result.research.providers).map(([provider, status]) => `${provider}=${status}`).join(", ")}.`,
      `Поисковых результатов: ${result.research.searchResults.length} · проверено страниц: ${result.research.crawledPages.length} · свидетельств: ${result.research.evidence.length}.`,
      "",
    );
    if (result.research.evidence.length > 0) {
      lines.push("Источники:", "", ...result.research.evidence.map((item) => `- [${escapeMarkdown(item.title)}](${item.url}) — ${item.source}`), "");
    }
    if (result.research.crawledPages.length > 0) {
      lines.push("Проверенные страницы:", "", ...result.research.crawledPages.map((page) => `- [${escapeMarkdown(page.title)}](${page.url}) — email: ${page.emails.length}, телефоны: ${page.phones.length}, соцсети: ${page.socialUrls.length}`), "");
    }
    if ((result.research.socialProfiles ?? []).length > 0) {
      lines.push("Социальные профили:", "", ...(result.research.socialProfiles ?? []).map((profile) => `- ${profile.platform}/${profile.kind}: [${escapeMarkdown(profile.personName ?? profile.displayName ?? profile.username ?? profile.url)}](${profile.url}) — confidence ${profile.confidence}%`), "");
    }
    if (result.selectedCandidates.length > 0) {
      lines.push("| Контакт | Должность | Каналы | Балл |", "|---|---|---|---:|");
      for (const candidate of result.selectedCandidates) {
        const channels = [...candidate.emails.map((email) => `${email.value} [${(email.status ?? (email.generic ? "general" : "found")).toUpperCase()}]`), ...candidate.phones, ...candidate.socialUrls].join("<br>");
        lines.push(`| ${escapeMarkdown(candidateName(candidate))} | ${escapeMarkdown(candidate.position ?? "—")} | ${escapeMarkdown(channels)} | ${candidate.score} |`);
      }
      lines.push("");
    } else {
      lines.push(`Подходящих контактов нет. Официальный сайт: ${result.discoveredWebsite ? "найден" : "не найден"}; search results: ${result.research.searchResults.length}; страниц: ${result.research.crawledPages.length}; sitemap URL: ${result.research.crawlDiagnostics?.sitemapEntries ?? 0}; ФИО: ${result.research.peopleFound ?? 0}.`, "");
    }
    const selectedKeys = new Set(result.selectedCandidates.map(candidateKey));
    const rejected = result.candidates.filter((candidate) => !selectedKeys.has(candidateKey(candidate)));
    if (rejected.length > 0) {
      lines.push(`Ниже порога или без прямого канала: ${rejected.length}.`, "", ...rejected.map((candidate) => `- ${escapeMarkdown(candidateName(candidate))} · ${candidate.position ?? "должность не найдена"} · ${candidate.score}/100 · ${candidate.scoreReasons.join("; ")}`), "");
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
