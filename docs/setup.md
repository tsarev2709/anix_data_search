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
| `TAVILY_API_KEY` | рекомендуется | ключ поиска |
| `HUNTER_API_KEY` | рекомендуется | ключ Domain Search / Verifier |
| `OPENAI_API_KEY` | нет | включает структурирование имён и ролей |

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
| `AMO_CONTACT_POSITION_FIELD_ID` | пусто | куда записывать должность |
| `MAX_COMPANIES` | `10` | недельная порция |
| `MAX_CONTACTS_PER_COMPANY` | `5` | предел на компанию |
| `MAX_PAGES_PER_SITE` | `8` | предел краулинга |
| `MIN_CONTACT_SCORE` | `35` | порог персонального контакта |
| `INCLUDE_GENERIC_EMAILS` | `true` | оставить официальный общий fallback |
| `CREATE_FOLLOW_UP_TASK` | `true` | задача ответственному |
| `FOLLOW_UP_DAYS` | `2` | срок задачи |
| `HUNTER_VERIFY_EMAILS` | `false` | включать после оценки расхода квоты |
| `OPENAI_MODEL` | `gpt-5.6-luna` | модель извлечения |
| `AUTO_APPLY` | `false` | главный предохранитель записи |

`TARGET_ROLES` можно задать строкой через `|`. Без переменной используются собственник, основатель, генеральный директор, маркетинг/бренд, HR/L&D, внутренние коммуникации, охрана труда и промышленная безопасность.

## 4. Первый запуск

1. Actions → **Weekly contact search** → Run workflow.
2. `mode = dry-run`, `max_companies = 3`.
3. Открыть job summary и артефакт `contact-search-*`.
4. Проверить компании, контакты, источники, скоринг и запланированные действия.
5. Повторить вручную с `mode = apply` на 3 компаниях.
6. Проверить карточки AmoCRM: отсутствие дублей, связи, примечания, задачи и переход этапа.
7. Только после этого установить `AUTO_APPLY=true`.

Расписание в workflow: каждый понедельник в 06:00 UTC, то есть 09:00 по Москве.
