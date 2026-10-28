<!-- autopilot:start -->
# Закупки Китай — PWA (React + Vite + TypeScript) без сервера; данные в Google-таблице пользователя

## Команды

- `npm ci` — установка (Node 20).
- `npm run dev -- --port 4198 --strictPort` — dev-сервер.
- `npm run check` — `tsc --noEmit` + все тесты; на чистом клоне один тест пропускается — `tests/import/reference.test.ts` без `fixtures/private/legacy.json`.
- `npx vitest run tests/domain/rates.test.ts` — один тестовый файл (собираются `tests/**` и `apps-script/test/**`).
- `npm run build` — типы + сборка в `dist/` с PWA manifest и sw.
- `npm run preview -- --port 4199 --strictPort` — раздача `dist/`.
- Выпуск версии: при каждой публикации поднять `version` в `package.json` и дописать запись в начало `CHANGELOG.md` и `src/changelog.ts` (простым языком; тест сверяет их с `package.json`).

## Где что

- Архитектура, поток данных, границы модулей, соглашения → `docs/architecture.md` (термины — `CONTEXT.md`, решения — `docs/adr/`).
- `src/store/schema.ts` — единственный источник правды о листах и колонках; `src/store/sheetsStore.ts` — чтение/запись в таблицу.
- `src/domain/costing/engine.ts` — движок себестоимости (правила в шапке файла); курсы — `src/domain/rates.ts`.
- `src/setup/` — привязка таблицы (`ensureSchema`, `installScript`, `connect`); `src/google/` — вход и обёртки над API.
- `apps-script/Code.gs` — скрипт курсов ВТБ в таблице; тесты — `apps-script/test/` (грузят `Code.gs` через `vm` с моками).
- `src/ui/App.tsx` — маршруты; `src/ui/DataContext.tsx` — сессия, `useData()`; экраны — `src/ui/screens/<имя>/`.
- `src/ui/components/` — общие компоненты; `src/ui/format.ts` — форматы показа; `src/ui/styles.css` — общие классы.
- `tests/` зеркалит `src/`; контракт хранилищ — `tests/store/contract.ts`; демо-данные — `src/demo/seed.ts`.

## Подводные камни

- Числа в Sheets пишутся RAW: `USER_ENTERED` в ru-локали превращает «1.5» в дату (`src/google/sheetsApi.ts`, ADR 0004).
- Пустая ячейка пишется `''`, не `null`: `null` Sheets пропускает и оставляет старое значение (`toRow` в `src/store/schema.ts`).
- Дата-время в serial — по Москве, UTC+3 константой (`datetimeToSerial`, `src/store/schema.ts`).
- `SheetsStore` читает колонки по заголовкам строки 1, не по позиции; перед `update`/`remove` перечитывает колонку `id`.
- Привязка отказывает таблице, где лист схемы с данными без `id` в строке 1 (`NotAppSpreadsheetError`, `src/setup/ensureSchema.ts`) и ничего не пишет.
- POST в Google не повторяется на 5xx, только на 429; GET/PUT/DELETE — и на 5xx (`src/google/http.ts`): запись могла пройти.
- Формульные колонки перевода (`customerNameEn`, `techParamsEn`) пишутся отдельным `USER_ENTERED`-запросом; из приложения они только читаются.
- Экраны меняют только свои файлы; общие компоненты — `src/ui/components/`, форматы — `src/ui/format.ts`; `App.tsx`, меню и `DataContext` — не в рамках экрана.
- `tests/project.test.ts` падает, если общие CSS-классы объявлены вне `styles.css` или в `src/` встретились слова вроде `openai`, `deepl`, `gemini` (запрет ИИ и машинного перевода).
- Правка `apps-script/Code.gs` или `appsscript.json` меняет `SCRIPT_VERSION` (хеш) — скрипт в привязанных таблицах переставится при следующем входе.
- `SheetsStore.load` сам проставляет `id` строкам, вбитым в таблицу без него (перечитывает лист перед записью; FALSE во флажках — не данные).
- Формулы перевода пишутся с разделителем из «Настройки».`formulaSeparator` (`,` или `;`, по умолчанию по локали таблицы); переписываются только формулы по шаблону приложения.
- Тип поставки поставщика в заказе — `plannedTypeId` (id из «Типов поставки»); у старых записей берётся по `plannedMode` (`plannedTypeIdOf`), разово дописывается при входе (`ensureCodes`, `CODES_VERSION`).
- Единица измерения товара — `Line.unit` из списка «Единицы измерения»; пусто — «шт» (`unitOf`). Список дописывается в таблицу при входе, если его нет.
- Специализаций у поставщика может быть несколько: одна ячейка через «; » (`src/domain/multiValue.ts`); делится только по «;», запятая — часть значения.
- `fixtures/private/` — реальные данные, вне git; не копировать содержимое в тесты и логи.
- Парсер ВТБ (`parseVtbRates_` в `apps-script/Code.gs`) проверен только на синтетических образцах (`apps-script/test/samples.ts`): настоящий ответ банка не видели; для проверки на месте — меню «Закупки» → «Проверить источник курсов», результат в листе «Лог».

## Правила полей (от пользователя, для всех новых полей)

- Поле, у которого есть список («Списки», справочник, «Типы поставки», «География»), — раскрывающийся список с поиском при вводе и «+ Добавить…» последним пунктом: новое значение сразу пишется в список. Для «Списков» — `ListSelectField`, справочников — `DirectorySelectField`, прочего — `AddableSelect search` (без `onAdd`, если запись здесь не заводится: позиции, заказы, поставки). Постоянные наборы (валюта, план/факт, по объёму/по весу) — простой список без «Добавить».
- Однострочное поле без списка — подсказки при вводе по прежним значениям этого поля: `TextField suggestions={pastValues(ds.<сущность>, '<поле>')}`. Многострочные комментарии — без подсказок.
- Одно поле — одно название во всех разделах, формах, шапках, подсказках и в заголовке колонки листа: названия берутся из `src/domain/labels.ts` (`F`, сокращения для узких шапок — `SHORT`, пояснения расчёта — `TIP`). Буквы колонок старой таблицы (AD, AW, AV, AB, Y) в видимых текстах не пишутся; почта называется «Email».
- Переименованная колонка листа получает прежнее название в `aliases` (`cr(...)` в `schema.ts`): `mapHeaders` находит её и по старому, `ensureSchema` переименовывает заголовок в таблице.

## Окружение

Читаются из `import.meta.env`, значения не логируются; образец — `.env.example`.

- `VITE_GOOGLE_CLIENT_ID` — OAuth Client ID; без него вход Google скрыт, доступен только демо-режим («Попробовать без Google»).
- `VITE_GOOGLE_API_KEY` — ключ API для выбора таблицы (Picker).
- `VITE_GOOGLE_APP_ID` — номер проекта Google Cloud для Picker.
- `VITE_BASE_PATH` — подпуть публикации на GitHub Pages (`/имя-репозитория/`); пусто — корень. В CI задаётся workflow'ом `.github/workflows/deploy.yml`.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».
<!-- autopilot:end -->
