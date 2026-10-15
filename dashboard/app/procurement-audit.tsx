import type { ProcurementResearch } from "../../src/procurement/types";

const roles = { customer: "Заказчик", supplier: "Участник / поставщик", winner: "Победитель", claimant: "Истец / заявитель", defendant: "Ответчик", unknown: "Роль не установлена" };
const statuses = { active: "Текущая процедура", completed: "Завершена", failed: "Не состоялась", cancelled: "Отменена", unknown: "Статус не установлен" };
const coverage = { disabled: "Проверка выключена", unavailable: "Поисковые источники недоступны", partial: "Частичная проверка", searched: "Поиск выполнен" };

export function ProcurementAudit({ research }: { research: ProcurementResearch }) {
  const s = research.summary;
  return <section className="audit-section procurement-audit">
    <p className="audit-title">Закупки и арбитражи</p>
    <p>{coverage[research.status]} · ИНН: {research.inn || "не указан"}</p>
    {research.innSource && <p className="audit-muted">Источник ИНН: {research.innSource.startsWith("https://") ? <a href={research.innSource} target="_blank" rel="noreferrer">Реквизиты на сайте компании ↗</a> : research.innSource === "amoCRM" ? "amoCRM" : "Ручной ввод"}</p>}
    <div className="crawl-stats">
      <span>Подтверждённых закупок: <b>{s.confirmedProcurements}</b></span>
      <span>Заказчик: <b>{s.customer}</b></span><span>Участник / поставщик: <b>{s.supplier}</b></span><span>Победитель: <b>{s.winner}</b></span>
      <span>Текущих: <b>{s.active}</b></span><span>Завершённых: <b>{s.completed}</b></span><span>Не состоялись: <b>{s.failed}</b></span>
      <span>Судебных дел: <b>{s.confirmedCases}</b></span><span>Связано с закупкой: <b>{s.linkedCases}</b></span><span>Кандидатов: <b>{s.candidates}</b></span><span>Ссылок на ТЗ: <b>{s.specificationLinks}</b></span>
    </div>
    <p className="audit-muted">Это найденная выборка. Ноль не подтверждает отсутствие торгов или споров. Совпадения только по названию требуют проверки юридического лица.</p>
    <div className="procurement-records">{research.records.map((record) => <article className="procurement-record" key={`${record.kind}-${record.url}`}>
      <small>{record.kind === "arbitration" ? "СУДЕБНОЕ ДЕЛО" : "ЗАКУПКА"} · {record.verification === "confirmed" ? "ПОДТВЕРЖДЕНО ПО ИНН И РОЛИ" : "ТРЕБУЕТ ПРОВЕРКИ"} · {record.authority === "primary" ? "Первичный источник" : "Вторичный источник"}</small>
      <h3><a href={record.url} target="_blank" rel="noreferrer">{record.title} ↗</a></h3>
      <p>{record.number || "Номер не установлен"} · {roles[record.role]} · {statuses[record.status]}</p>
      {record.parties.map((party) => <p key={party.role}><b>{party.role}:</b> {party.description}</p>)}
      <dl><dt>Предмет</dt><dd>{record.subject || "Не извлечён"}</dd><dt>Сумма по источнику</dt><dd>{record.amount || "Не извлечена"}</dd><dt>Срок подачи</dt><dd>{record.deadline || "Не извлечён"}</dd>{record.outcome && <><dt>Исход по источнику</dt><dd>{record.outcome}</dd></>}</dl>
      {record.documents.length > 0 ? <ul>{record.documents.map((document) => <li key={document.url}><a href={document.url} target="_blank" rel="noreferrer">{document.kind === "specification" ? "ТЗ · " : document.kind === "protocol" ? "Протокол · " : ""}{document.title} ↗</a></li>)}</ul> : <p className="audit-muted">{record.documentsAccess === "restricted" ? "Документация требует входа на площадку. Откройте карточку выше." : "Прямые ссылки на документы не найдены или карточка не прочитана."}</p>}
      {record.relationEvidence && <div><p>{record.relationEvidence}</p>{record.relatedProcurementUrls.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer">Связанная закупка ↗ </a>)}</div>}
      <details><summary>Свидетельство и источник</summary><p>{record.evidence}</p><p>{record.source} · {record.fetchedAt ? `Карточка прочитана: ${record.fetchedAt}` : "Только поисковая находка"}</p></details>
    </article>)}</div>
    <p className="audit-title">Следующие действия</p><ul>{s.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
    {research.warnings.length > 0 && <details><summary>Ограничения источников · {research.warnings.length}</summary><ul>{research.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
    <details><summary>Поисковые запросы · {research.queries.length} из {research.plannedQueries.length} запланированных</summary><ol>{research.queries.map((query) => <li key={query}>{query}</li>)}</ol></details>
  </section>;
}
