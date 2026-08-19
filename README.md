# Anix Data Search

Облачный еженедельный поиск актуальных деловых контактов для сделок Anix из этапа AmoCRM «Поиск контактов». Отдельный сервер и постоянно включённый компьютер не нужны: процесс запускается в GitHub Actions, складывает кандидатов в закрытую панель проверки и отправляет одобренные записи в CRM.

## Что умеет free-first версия

- забирает ограниченную порцию сделок из заданной воронки и этапа AmoCRM;
- работает без Tavily, Hunter и OpenAI: параллельно использует SearXNG, Google News RSS, GDELT, Common Crawl и GitHub;
- при наличии бесплатного Gemini API key добавляет Google Search grounding, но не зависит от него;
- берёт компанию и сайт из карточки, ищет официальный домен, новости, публичные выступления, назначения и профили ЛПР;
- учитывает `robots.txt`, рекурсивные sitemap, RSS/Atom, WordPress API, HTML/JSON-LD, PDF и ограниченный Playwright fallback для SPA;
- извлекает email, телефоны, ФИО, должности, Telegram, VK, YouTube, Rutube, TenChat, Threads, Instagram, LinkedIn и GitHub;
- проводит второй этап поиска отдельно по наиболее перспективным найденным людям;
- при наличии Hunter получает имена, должности, источники и проверку доставляемости email;
- без LLM извлекает русские ФИО и должности детерминированными правилами; OpenAI остаётся опциональным fallback;
- разделяет email на `FOUND`, `GENERAL` и `INFERRED`, проверяет MX и никогда не записывает inferred-адрес в AmoCRM;
- объединяет дубли, оценивает качество и сохраняет ссылки-доказательства;
- в `enrich` добавляет контакты в исходную сделку, а в `new_lead` создаёт отдельную новую сделку на контакт;
- создаёт примечание с источниками и задачу на персональное касание;
- после успешной записи может передвинуть исходную сделку в следующий этап;
- прикладывает Markdown и JSON отчёты с запросами, providers, страницами, источниками, сбоями, отклонёнными кандидатами и причинами к каждому запуску Actions;
- сохраняет выбранных кандидатов в Supabase и показывает их в приватной админ-панели;
- позволяет одобрить или отклонить контакт и отдельным запуском отправить только одобренные записи в AmoCRM;
- автоматически выкатывает панель в Cloudflare Workers и Edge Function в Supabase после merge в `main`.

## Безопасный режим

По умолчанию включён `CONTACT_SEARCH_MODE=dry-run`. В этом режиме система читает AmoCRM и интернет, рассчитывает результат, но ничего не меняет. Плановая запись включается только переменной репозитория `AUTO_APPLY=true`.

Рекомендуемый режим — `AMO_WRITE_MODE=enrich`: новые контакты прикрепляются к уже существующим сделкам из «Поиска контактов». Режим `new_lead` предусмотрен для сценария «один найденный контакт → одна новая сделка», но требует отдельной выходной воронки и этапа.

## Источники

| Источник | Ключ | Что даёт |
|---|---:|---|
| Официальный сайт / sitemap / RSS / WordPress / PDF | нет | email, телефоны, ФИО, должности, документы и официальные соцсети |
| SearXNG | нет | матрица web- и social-запросов через несколько публичных instances |
| Google News RSS + GDELT | нет | свежие назначения, интервью, выступления и новости |
| Common Crawl | нет | исторически известные полезные URL, которые затем проверяются на живом сайте |
| GitHub | нет | публичные профили, организации, bio, company, blog и public email |
| Gemini + Google Search | опциональный free-tier key | grounded web discovery; отсутствие ключа не ухудшает базовый pipeline до нерабочего состояния |
| Tavily Search | опционально | дополнительный web search fallback |
| Hunter Domain Search | опционально | дополнительный источник персональных email и confidence |
| Hunter Email Verifier | опционально | доставляемость; расходует дополнительные запросы |
| OpenAI Structured Outputs | опционально | связывает имя, роль и каналы без генерации несуществующих адресов |

Общие адреса вроде `info@` не выбрасываются. Если персонального контакта нет, один официальный общий email остаётся fallback-кандидатом с низким баллом. Наличие MX означает только то, что домен принимает почту; это не проверка существования конкретного ящика.

## Быстрый старт

```bash
npm ci
cp .env.example .env
# заполнить AMO_BASE_URL и AMO_ACCESS_TOKEN
npm run inspect:amo > amo-structure.json
npm run check
npm start
```

`inspect:amo` выполняет только чтение. Он показывает воронки, этапы и поля, чтобы заполнить ID без угадывания.

Для рабочего запуска настройте GitHub Secrets и Variables по инструкции [docs/setup.md](docs/setup.md), затем вручную запустите workflow **Weekly contact search** с операцией `research` в режиме `dry-run`.

## Команды

| Команда | Назначение |
|---|---|
| `npm run inspect:amo` | получить структуру AmoCRM без изменений |
| `npm start` | выполнить один запуск |
| `npm run check` | типы и тесты |
| `npm run build` | production-компиляция TypeScript |

## Документация

- [Архитектура и поток данных](docs/architecture.md)
- [Настройка GitHub и AmoCRM](docs/setup.md)
- [Эксплуатация, скоринг и восстановление после ошибок](docs/operations.md)

Использованные API: [AmoCRM сделки](https://www.amocrm.ru/developers/content/crm_platform/leads-api), [контакты](https://www.amocrm.ru/developers/content/crm_platform/contacts-api), [связи](https://www.amocrm.ru/developers/content/crm_platform/entity-links-api), [Hunter API v2](https://hunter.io/api-documentation/v2), [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
