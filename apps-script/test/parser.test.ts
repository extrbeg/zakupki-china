// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEnv, plain } from './harness';
import { EXPECTED, FOREIGN, HTML_EMBEDDED_JSON, HTML_TABLE_COLUMNS, HTML_TABLE_ROWS, JSON_API } from './samples';

const parse = (body: string) => plain(createEnv().gs.parseVtbRates_(body));

describe('parseVtbRates_ — курс продажи диапазона «до 10 000»', () => {
  it('JSON API: группа «онлайн, без подписок», диапазон 0–10 000, больший из пары', () => {
    expect(parse(JSON_API)).toEqual(EXPECTED);
  });

  it('JSON внутри HTML-страницы: валюта уровнем выше, диапазон текстом, числа строками с запятой', () => {
    expect(parse(HTML_EMBEDDED_JSON)).toEqual(EXPECTED);
  });

  it('HTML-таблица: строки по диапазонам, валюта в объединённой ячейке, перед ней таблица наличных', () => {
    expect(parse(HTML_TABLE_ROWS)).toEqual(EXPECTED);
  });

  it('HTML-таблица: диапазоны в заголовках колонок, под ними покупка/продажа', () => {
    expect(parse(HTML_TABLE_COLUMNS)).toEqual(EXPECTED);
  });

  it('курс продажи — больший из пары, даже если поля названы с точки зрения клиента', () => {
    const body = JSON.stringify({ rates: [{ currency: 'USD', amountFrom: 0, amountTo: 10000, clientSell: 79.5, clientBuy: 84.25 }] });
    expect(parse(body)).toEqual([{ currency: 'USD', rate: 84.25 }]);
  });

  it('только часть валют — возвращает найденные', () => {
    const body = JSON.stringify({ items: [{ code: 'EUR', min: 0, max: 10000, buy: 87, sell: 93.4 }] });
    expect(parse(body)).toEqual([{ currency: 'EUR', rate: 93.4 }]);
  });

  it.each(Object.entries(FOREIGN))('чужой ответ (%s) → []', (_name, body) => {
    expect(parse(body)).toEqual([]);
  });

  it('null и undefined → []', () => {
    const gs = createEnv().gs;
    expect(plain(gs.parseVtbRates_(null))).toEqual([]);
    expect(plain(gs.parseVtbRates_(undefined))).toEqual([]);
  });
});
