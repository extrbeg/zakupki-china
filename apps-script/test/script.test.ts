// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEnv, isDate, LOG_HEADER, MANIFEST_PATH, plain, RATES_HEADER, SETTINGS_HEADER, Utilities } from './harness';
import { JSON_API } from './samples';

// 22:30 UTC 25 октября = 01:30 МСК 26 октября: «сегодня» по Москве — 2026-10-26
const NOW = '2026-10-25T22:30:00Z';
const TODAY = '2026-10-26';
const DEFAULT_URL = 'https://www.vtb.ru/personal/platezhi-i-perevody/obmen-valjuty/';
const msk = (d: unknown) => Utilities.formatDate(d as Date, 'Europe/Moscow', 'yyyy-MM-dd');
const mskDate = (iso: string) => Utilities.parseDate(iso, 'Europe/Moscow', 'yyyy-MM-dd');

function baseSheets(extraRates: unknown[][] = [], settings: unknown[][] = []) {
  return {
    'Курсы': [RATES_HEADER, ...extraRates],
    'Настройки': [SETTINGS_HEADER, ['vatRateDefault', '22'], ...settings],
    'Лог': [LOG_HEADER],
  };
}
const ok = () => ({ code: 200, body: JSON_API, contentType: 'application/json; charset=utf-8' });
const vtbRows = (env: ReturnType<typeof createEnv>) => env.sheet('Курсы')!.records().filter((r) => r['Источник'] === 'vtb');
const logText = (env: ReturnType<typeof createEnv>) => env.sheet('Лог')!.records().map((r) => `${r['Уровень']} ${r['Сообщение']}\n${r['Подробности']}`).join('\n');

describe('appsscript.json', () => {
  it('часовой пояс Москвы, V8 и нужные разрешения', () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(m.timeZone).toBe('Europe/Moscow');
    expect(m.runtimeVersion).toBe('V8');
    expect(m.oauthScopes).toEqual(expect.arrayContaining([
      'https://www.googleapis.com/auth/spreadsheets.currentonly',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.scriptapp',
    ]));
  });
});

describe('меню и триггер', () => {
  it('onOpen строит меню «Закупки» из трёх пунктов', () => {
    const env = createEnv();
    env.gs.onOpen();
    expect(env.menus).toHaveLength(1);
    expect(env.menus[0].title).toBe('Закупки');
    expect(env.menus[0].items).toEqual([
      { caption: 'Включить ежедневные курсы', fn: 'enableDailyRates' },
      { caption: 'Обновить курсы сейчас', fn: 'fetchRatesNow' },
      { caption: 'Проверить источник курсов', fn: 'diagnoseRatesSource' },
    ]);
    for (const item of env.menus[0].items) expect(typeof env.gs[item.fn]).toBe('function');
  });

  it('enableDailyRates ставит ровно один ежедневный триггер ~10:00 МСК и сразу грузит курсы', () => {
    const env = createEnv({ sheets: baseSheets(), fetch: ok, now: NOW });
    env.gs.enableDailyRates();
    env.gs.enableDailyRates();
    expect(env.triggers).toHaveLength(1);
    expect(env.triggers[0]).toMatchObject({ handler: 'fetchRatesDaily', everyDays: 1, atHour: 10, timezone: 'Europe/Moscow' });
    expect(env.fetchCalls.length).toBeGreaterThanOrEqual(1);
    expect(vtbRows(env)).toHaveLength(3);
  });

  it('enableDailyRates убирает лишние копии триггера', () => {
    const env = createEnv({ sheets: baseSheets(), fetch: ok, now: NOW });
    env.gs.ScriptApp.newTrigger('fetchRatesDaily').timeBased().everyDays(1).atHour(10).create();
    env.gs.ScriptApp.newTrigger('fetchRatesDaily').timeBased().everyDays(1).atHour(10).create();
    env.gs.ScriptApp.newTrigger('otherJob').timeBased().everyDays(1).atHour(3).create();
    env.gs.enableDailyRates();
    expect(env.triggers.filter((t) => t.handler === 'fetchRatesDaily')).toHaveLength(1);
    expect(env.triggers.filter((t) => t.handler === 'otherJob')).toHaveLength(1);
  });
});

describe('upsertRates_', () => {
  it('одна строка на (дата, валюта, vtb): id, дата Date с форматом даты, время загрузки Date', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW });
    const sheet = env.sheet('Курсы')!;
    env.gs.upsertRates_(sheet, TODAY, [{ currency: 'USD', rate: 84.25 }, { currency: 'CNY', rate: 11.85 }], 'vtb', false);
    const rows = sheet.records();
    expect(rows.map((r) => [r.id, r['Валюта'], r['Курс'], r['Источник']])).toEqual([
      [`r_${TODAY}_USD_vtb`, 'USD', 84.25, 'vtb'],
      [`r_${TODAY}_CNY_vtb`, 'CNY', 11.85, 'vtb'],
    ]);
    expect(isDate(rows[0]['Дата'])).toBe(true);
    expect(msk(rows[0]['Дата'])).toBe(TODAY);
    expect(Utilities.formatDate(rows[0]['Дата'] as Date, 'Europe/Moscow', 'HH:mm')).toBe('00:00');
    expect(isDate(rows[0]['Загружено'])).toBe(true);
    expect((rows[0]['Загружено'] as Date).toISOString()).toBe(new Date(NOW).toISOString());
    expect(sheet.formatAt(2, 2)).toMatch(/dd.*mm.*yyyy/i);
    expect(sheet.formatAt(2, 6)).toMatch(/hh:mm/i);
  });

  it('overwrite=false не трогает существующие, overwrite=true перезаписывает без дублей; ручные курсы не трогает', () => {
    const manual = ['r_manual_1', mskDate(TODAY), 'USD', 90, 'manual', '', 'вручную'];
    const env = createEnv({ sheets: baseSheets([manual]), now: NOW });
    const sheet = env.sheet('Курсы')!;
    env.gs.upsertRates_(sheet, TODAY, [{ currency: 'USD', rate: 84.25 }], 'vtb', false);
    const skipped = plain(env.gs.upsertRates_(sheet, TODAY, [{ currency: 'USD', rate: 99 }], 'vtb', false));
    expect(skipped).toMatchObject({ written: 0, skipped: 1 });
    expect(sheet.records().filter((r) => r['Источник'] === 'vtb').map((r) => r['Курс'])).toEqual([84.25]);
    env.gs.upsertRates_(sheet, TODAY, [{ currency: 'USD', rate: 85 }], 'vtb', true);
    const vtb = sheet.records().filter((r) => r['Источник'] === 'vtb');
    expect(vtb.map((r) => [r.id, r['Курс']])).toEqual([[`r_${TODAY}_USD_vtb`, 85]]);
    expect(sheet.records().find((r) => r.id === 'r_manual_1')).toMatchObject({ 'Курс': 90, 'Комментарий': 'вручную' });
  });

  it('узнаёт строку того же дня по дате и валюте, даже без id, и убирает дубли при перезаписи', () => {
    const env = createEnv({ sheets: baseSheets([
      ['', mskDate(TODAY), 'EUR', 90, 'vtb', '', ''],
      [`r_${TODAY}_EUR_vtb`, mskDate(TODAY), 'EUR', 91, 'vtb', '', ''],
      ['r_old', mskDate('2026-10-25'), 'EUR', 92, 'vtb', '', ''],
    ]), now: NOW });
    const sheet = env.sheet('Курсы')!;
    env.gs.upsertRates_(sheet, TODAY, [{ currency: 'EUR', rate: 93.4 }], 'vtb', true);
    const eur = sheet.records().filter((r) => r['Валюта'] === 'EUR');
    expect(eur.map((r) => [msk(r['Дата']), r['Курс']])).toEqual([[TODAY, 93.4], ['2026-10-25', 92]]);
  });
});

describe('fetchRatesNow / fetchRatesDaily', () => {
  it('fetchRatesNow: адрес из «Настройки», параметры запроса, сегодняшние курсы по Москве', () => {
    const env = createEnv({ sheets: baseSheets([], [['ratesSourceUrl', ' https://example.test/rates.json ']]), fetch: ok, now: NOW });
    env.gs.fetchRatesNow();
    expect(env.fetchCalls).toHaveLength(1);
    const call = env.fetchCalls[0];
    expect(call.url).toBe('https://example.test/rates.json');
    expect(call.params).toMatchObject({ muteHttpExceptions: true, validateHttpsCertificates: false });
    expect(String((call.params.headers as Record<string, string>)['User-Agent'])).toMatch(/Mozilla\/5\.0/);
    expect(vtbRows(env).map((r) => [r.id, msk(r['Дата']), r['Валюта'], r['Курс']])).toEqual([
      [`r_${TODAY}_USD_vtb`, TODAY, 'USD', 84.25],
      [`r_${TODAY}_EUR_vtb`, TODAY, 'EUR', 93.4],
      [`r_${TODAY}_CNY_vtb`, TODAY, 'CNY', 11.85],
    ]);
  });

  it('без настройки берёт страницу обмена валют ВТБ', () => {
    const env = createEnv({ sheets: baseSheets(), fetch: ok, now: NOW });
    env.gs.fetchRatesNow();
    expect(env.fetchCalls[0].url).toBe(DEFAULT_URL);
  });

  it('fetchRatesNow перезаписывает сегодняшние vtb-строки', () => {
    const env = createEnv({ sheets: baseSheets([[`r_${TODAY}_USD_vtb`, mskDate(TODAY), 'USD', 70, 'vtb', '', '']]), fetch: ok, now: NOW });
    env.gs.fetchRatesNow();
    expect(vtbRows(env).filter((r) => r['Валюта'] === 'USD').map((r) => r['Курс'])).toEqual([84.25]);
  });

  it('fetchRatesDaily не перезаписывает и не ходит в сеть, если сегодняшние курсы уже есть', () => {
    const today = (cur: string, rate: number) => [`r_${TODAY}_${cur}_vtb`, mskDate(TODAY), cur, rate, 'vtb', '', ''];
    const env = createEnv({ sheets: baseSheets([today('USD', 70), today('EUR', 71), today('CNY', 9)]), fetch: ok, now: NOW, noUi: true });
    env.gs.fetchRatesDaily({});
    expect(env.fetchCalls).toHaveLength(0);
    expect(vtbRows(env).map((r) => r['Курс'])).toEqual([70, 71, 9]);
  });

  it('fetchRatesDaily дописывает недостающие, существующие не трогает', () => {
    const env = createEnv({ sheets: baseSheets([[`r_${TODAY}_USD_vtb`, mskDate(TODAY), 'USD', 70, 'vtb', '', '']]), fetch: ok, now: NOW, noUi: true });
    env.gs.fetchRatesDaily({});
    expect(vtbRows(env).map((r) => [r['Валюта'], r['Курс']])).toEqual([['USD', 70], ['EUR', 93.4], ['CNY', 11.85]]);
  });

  it('создаёт лист «Курсы» с заголовками схемы, если его нет', () => {
    const env = createEnv({ sheets: { 'Лог': [LOG_HEADER] }, fetch: ok, now: NOW, noUi: true });
    env.gs.fetchRatesDaily({});
    expect(env.sheet('Курсы')!.data[0]).toEqual(RATES_HEADER);
    expect(vtbRows(env)).toHaveLength(3);
  });
});

describe('сбои источника: строки не пишутся, причина — в «Лог»', () => {
  it('ошибка сети', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, noUi: true, fetch: () => { throw new Error('Address unavailable: https://www.vtb.ru'); } });
    env.gs.fetchRatesDaily({});
    expect(vtbRows(env)).toHaveLength(0);
    expect(logText(env)).toMatch(/ERROR/);
    expect(logText(env)).toMatch(/Address unavailable/);
  });

  it('код ответа не 200', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => ({ code: 503, body: 'Service Unavailable', contentType: 'text/plain' }) });
    env.gs.fetchRatesNow();
    expect(vtbRows(env)).toHaveLength(0);
    expect(logText(env)).toMatch(/ERROR/);
    expect(logText(env)).toMatch(/503/);
  });

  it('пустой разбор', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => ({ code: 200, body: '<html><body>Технические работы</body></html>' }) });
    env.gs.fetchRatesNow();
    expect(vtbRows(env)).toHaveLength(0);
    expect(logText(env)).toMatch(/ERROR/);
    expect(logText(env)).toMatch(/Проверить источник курсов/);
  });

  it('время записи в «Лог» — Date', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => ({ code: 500, body: '' }) });
    env.gs.fetchRatesNow();
    const row = env.sheet('Лог')!.records()[0];
    expect(isDate(row['Время'])).toBe(true);
  });
});

describe('diagnoseRatesSource', () => {
  it('пишет URL, код, content-type, первые 5000 символов и результат разбора; курсы не пишет', () => {
    const tail = 'Z'.repeat(3000);
    const body = JSON_API + ' '.repeat(Math.max(0, 5000 - JSON_API.length)) + tail;
    const head5000 = body.slice(0, 5000);
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => ({ code: 200, body, contentType: 'application/json; charset=utf-8' }) });
    env.gs.diagnoseRatesSource();
    const log = logText(env);
    expect(log).toContain(DEFAULT_URL);
    expect(log).toMatch(/200/);
    expect(log).toContain('application/json; charset=utf-8');
    expect(log).toContain(head5000);
    expect(log).not.toContain(body.slice(0, 5001));
    expect(log).toMatch(/USD\D+84\.25/);
    expect(log).toMatch(/EUR\D+93\.4/);
    expect(log).toMatch(/CNY\D+11\.85/);
    expect(vtbRows(env)).toHaveLength(0);
    expect(env.alerts.join(' ')).toMatch(/Лог/);
  });

  it('при ошибке сети пишет адрес и текст ошибки', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => { throw new Error('SSL handshake failed'); } });
    env.gs.diagnoseRatesSource();
    const log = logText(env);
    expect(log).toContain(DEFAULT_URL);
    expect(log).toContain('SSL handshake failed');
  });

  it('пустой разбор отмечен явно', () => {
    const env = createEnv({ sheets: baseSheets(), now: NOW, fetch: () => ({ code: 200, body: '<html>ничего</html>', contentType: 'text/html' }) });
    env.gs.diagnoseRatesSource();
    expect(logText(env)).toMatch(/USD: не найден/);
  });
});
