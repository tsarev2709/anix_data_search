# Настройка

## 1. AmoCRM

Нужен токен интеграции с правами чтения и записи сделок, компаний, контактов, примечаний и задач. Токен не помещается в `.env.example`, код, отчёты или GitHub Variables.

Для получения ID локально:

```bash
cp .env.example .env
# заполнить AMO_BASE_URL и AMO_ACCESS_TOKEN
npm ci
npm run inspect:amo > amo-structure.json
```

В `amo-structure.json` найдите:

- ID воронки, где находится этап «Поиск контактов»;
- ID самого этапа «Поиск контактов»;
- ID этапа, куда уходят успешно обработанные исходные сделки;
- при необходимости — ID поля сайта компании и поля должности контакта;
- для `new_lead` — ID выходной воронки и стартового этапа.

Файл `amo-structure.json` игнорируется Git и не должен коммититься.

## 2. GitHub Secrets

Repository → Settings → Secrets and variables → Actions → **Secrets**:

| Имя | Обязательно | Значение |
|---|---:|---|
| `AMO_BASE_URL` | да | `https://studioanixaipro.amocrm.ru` |
| `AMO_ACCESS_TOKEN` | да | токен интеграции |
| `GEMINI_API_KEY` | нет | Gemini extraction/grounding; перед включением проверить текущий тариф |
| `YOUTUBE_API_KEY` | нет | свежий поиск видео и каналов для радара спроса |
| `TAVILY_API_KEY` | нет | дополнительный платный/лимитированный поиск |
| `HUNTER_API_KEY` | нет | дополнительный Domain Search / Verifier |
| `OPENAI_API_KEY` | нет | включает структурирование имён и ролей |
| `SUPABASE_URL` | для панели | URL проекта, также используется runner-ом |
| `SUPABASE_ANON_KEY` | для панели | публичный ключ браузерного клиента |
| `SUPABASE_SERVICE_ROLE_KEY` | для панели | только серверный ключ записи результатов |
| `SUPABASE_ACCESS_TOKEN` | для деплоя | токен Supabase CLI |
| `SUPABASE_DB_PASSWORD` | для деплоя | пароль БД для применения миграций |
| `CLOUDFLARE_API_TOKEN` | для деплоя | токен с правом Workers Scripts: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | для деплоя | ID аккаунта Cloudflare |
| `ADMIN_EMAILS` | для панели | разрешённые рабочие email через запятую |
| `DASHBOARD_ORIGINS` | для панели | production URL панели без завершающего `/` |
| `DASHBOARD_GITHUB_TOKEN` | для панели | fine-grained token с Actions: Read and write только для этого репозитория |

## 3. GitHub Variables

На той же странице откройте **Variables**:

| Имя | Стартовое значение | Пояснение |
|---|---|---|
| `AMO_PIPELINE_ID` | ID воронки | обязательное |
| `AMO_SOURCE_STATUS_ID` | ID «Поиск контактов» | обязательное |
| `AMO_SUCCESS_STATUS_ID` | ID следующего этапа | настоятельно рекомендуется |
| `AMO_WRITE_MODE` | `enrich` | `enrich` или `new_lead` |
| `AMO_OUTPUT_PIPELINE_ID` | пусто | только для `new_lead` |
| `AMO_OUTPUT_STATUS_ID` | пусто | только для `new_lead` |
| `AMO_COMPANY_WEBSITE_FIELD_ID` | пусто | если поле сайта не определяется автоматически |
| `AMO_COMPANY_NAME_FIELD_ID` | пусто | fallback названия компании из custom field сделки |
| `AMO_CONTACT_POSITION_FIELD_ID` | пусто | куда записывать должность |
| `MAX_COMPANIES` | `10` | ежедневная порция |
| `MAX_CONTACTS_PER_COMPANY` | `5` | предел на компанию |
| `MAX_PAGES_PER_SITE` | `8` | предел краулинга |
| `MIN_CONTACT_SCORE` | `35` | порог персонального контакта |
| `INCLUDE_GENERIC_EMAILS` | `true` | оставить официальный общий fallback |
| `CREATE_FOLLOW_UP_TASK` | `true` | задача ответственному |
| `FOLLOW_UP_DAYS` | `2` | срок задачи |
| `HUNTER_VERIFY_EMAILS` | `false` | включать после оценки расхода квоты |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | модель Gemini; grounding может тарифицироваться отдельно |
| `SEARXNG_INSTANCES` | пусто | необязательный список JSON-enabled instances через запятую; без него используется встроенная ротация |
| `DEMAND_QUERY_BUDGET` | `36` | сколько запросов из расширенного каталога выполнять за день |
| `DEMAND_MAX_SIGNALS` | `120` | максимум новых сигналов в отчёте |
| `DEMAND_FEEDS` | пусто | дополнительные RSS/Atom URL через запятую |
| `OPENAI_MODEL` | `gpt-5.6-luna` | модель извлечения |
| `AUTO_APPLY` | `false` | главный предохранитель записи |
| `SUPABASE_PROJECT_ID` | project ref | используется workflow деплоя |

`TARGET_ROLES` можно задать строкой через `|`. Без переменной используются собственник, основатель, генеральный директор, маркетинг/бренд, HR/L&D, внутренние коммуникации, охрана труда и промышленная безопасность.

## 4. Закрытая панель

Панель может использовать общий Supabase-проект с `anix_dashboard`: её таблицы имеют отдельный префикс `contact_search_`, а миграция идемпотентна.


1. Создайте Supabase project и скопируйте URL, anon key, service role key, project ref и DB password в GitHub.
2. После первого merge workflow **Deploy admin dashboard** применит миграцию, развернёт Edge Function и Cloudflare Worker.
3. Workflow сам передаст `ADMIN_EMAILS`, origin и GitHub token в Edge Function; вручную копировать их в Supabase не нужно.
4. В Supabase Auth добавьте production URL панели в Redirect URLs и включите вход по email magic link.

В браузер попадают только URL Supabase и anon key. Service role, AmoCRM и GitHub token остаются в server-side secrets. RLS не даёт браузерному пользователю прямого доступа к таблицам; чтение и решения проходят через Edge Function с allowlist email.

## 5. Первый запуск

1. Actions → **Daily contact intelligence** → Run workflow.
2. `operation = research`, `mode = dry-run`, `max_companies = 10`.
3. Открыть job summary и артефакт `contact-search-*`.
4. Проверить компании, контакты, источники, скоринг и запланированные действия.
5. В панели одобрить тестовые контакты и нажать «Отправить одобренные в AmoCRM».
6. Проверить карточки AmoCRM: отсутствие дублей, связи, примечания, задачи и переход этапа.
7. `AUTO_APPLY` оставлять `false`, пока нужен ручной контроль.

Для free-first запуска достаточно обязательных AmoCRM и Supabase secrets. `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, Tavily, Hunter и OpenAI можно не добавлять: их статус будет `disabled`, а SearXNG, Google News RSS, GDELT, Common Crawl, GitHub, RSS, Hacker News, Stack Exchange, crawler, PDF и DNS продолжат работать. Публичные SearXNG instances нестабильны по своей природе; ошибки и реально отправленные запросы показываются в аудите.

Расписание в workflow: ежедневно в 02:20 UTC, то есть 05:20 по Москве. Плановый запуск всегда работает в `dry-run`: он обновляет радар спроса и исследует до 10 компаний из очереди AmoCRM, но не пишет контакты в CRM без ручного одобрения.

Подключение Telegram MTProto, VK, Brave Search и других усилителей описано в [api-roadmap.md](api-roadmap.md).
