// Синтетические образцы ответа источника курсов. Реальный ответ ВТБ не видели (с машины разработки сайт недоступен),
// поэтому образцы покрывают правдоподобные форматы: JSON API, JSON внутри HTML-страницы, две раскладки HTML-таблицы.
// Во всех образцах верный ответ — курс продажи диапазона «до 10 000» в группе «В ВТБ Онлайн, без подписок»:
export const EXPECTED = [
  { currency: 'USD', rate: 84.25 },
  { currency: 'EUR', rate: 93.4 },
  { currency: 'CNY', rate: 11.85 },
];

const moneyRate = (code: string, name: string, from: number, to: number | null, buy: number, sell: number) => ({
  FromCurrency: { Code: code, Name: name }, ToCurrency: { Code: 'RUR', Name: 'Российский рубль' },
  BankBuyAt: buy, BankSellAt: sell, StartBalance: from, EndBalance: to,
});

/** JSON API: группы условий, в каждой — пары валют с диапазонами сумм; ловушки: наличные, подписка. */
export const JSON_API = JSON.stringify({
  DateFrom: '2026-10-26T00:00:00',
  GroupedRates: [
    {
      Title: 'Наличные в офисе',
      MoneyRates: [
        moneyRate('USD', 'Доллар США', 0, 10000, 78.1, 86.9),
        moneyRate('EUR', 'Евро', 0, 10000, 86.0, 95.5),
        moneyRate('CNY', 'Китайский юань', 0, 10000, 10.2, 12.6),
      ],
    },
    {
      Title: 'В ВТБ Онлайн (и в офисе безналично)',
      Subtitle: 'Без подписок и пакетов услуг',
      MoneyRates: [
        moneyRate('USD', 'Доллар США', 10000, 100000, 79.9, 83.95),
        moneyRate('USD', 'Доллар США', 0, 10000, 79.5, 84.25),
        moneyRate('USD', 'Доллар США', 100000, null, 80.1, 83.7),
        moneyRate('EUR', 'Евро', 0, 10000, 87.0, 93.4),
        moneyRate('EUR', 'Евро', 10000, null, 87.4, 93.0),
        moneyRate('CNY', 'Китайский юань', 0, 10000, 10.9, 11.85),
        moneyRate('CNY', 'Китайский юань', 10000, null, 11.0, 11.7),
      ],
    },
    {
      Title: 'С подпиской «Привилегия»',
      MoneyRates: [
        moneyRate('USD', 'Доллар США', 0, 10000, 80.0, 83.5),
        moneyRate('EUR', 'Евро', 0, 10000, 88.0, 92.6),
        moneyRate('CNY', 'Китайский юань', 0, 10000, 11.1, 11.6),
      ],
    },
  ],
});

/** Страница с данными внутри <script type="application/json">: валюта уровнем выше, диапазон текстом, числа строками с запятой. */
export const HTML_EMBEDDED_JSON = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Обмен валюты — ВТБ</title>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);}</script>
<style>.a{color:red}</style>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { exchange: {
    tabs: [
      { title: 'Наличные', currencies: [
        { currency: 'USD', ranges: [{ range: 'до 10 000', buy: '78,10', sell: '86,90' }] },
        { currency: 'EUR', ranges: [{ range: 'до 10 000', buy: '86,00', sell: '95,50' }] },
        { currency: 'CNY', ranges: [{ range: 'до 10 000', buy: '10,20', sell: '12,60' }] },
      ] },
      { title: 'В ВТБ Онлайн (и в офисе безналично)', tariff: 'Без подписок и пакетов услуг', currencies: [
        { currency: 'USD', ranges: [
          { range: 'до 10 000', buy: '79,50', sell: '84,25' },
          { range: 'от 10 000 до 100 000', buy: '79,90', sell: '83,95' },
          { range: 'свыше 100 000', buy: '80,10', sell: '83,70' },
        ] },
        { currency: 'EUR', ranges: [
          { range: 'от 10 000', buy: '87,40', sell: '93,00' },
          { range: 'до 10 000', buy: '87,00', sell: '93,40' },
        ] },
        { currency: 'CNY', ranges: [
          { range: 'до 10 000', buy: '10,90', sell: '11,85' },
          { range: 'от 10 000', buy: '11,00', sell: '11,70' },
        ] },
        { currency: 'GBP', ranges: [{ range: 'до 10 000', buy: '101,00', sell: '109,00' }] },
      ] },
    ],
  } } },
})}</script></head><body><div id="__next"></div></body></html>`;

/** HTML: таблица наличных, затем таблица «онлайн» — строки по диапазонам, валюта объединённой ячейкой (rowspan). */
export const HTML_TABLE_ROWS = `<html><body>
<h2>Наличные в отделениях</h2>
<table class="rates"><tr><th>Валюта</th><th>Сумма</th><th>Покупка</th><th>Продажа</th></tr>
<tr><td>USD</td><td>любая</td><td>78,00</td><td>87,00</td></tr>
<tr><td>EUR</td><td>любая</td><td>86,00</td><td>95,50</td></tr>
<tr><td>CNY</td><td>любая</td><td>10,20</td><td>12,60</td></tr>
</table>
<h2>В ВТБ Онлайн (и в офисе безналично)</h2><p>Без подписок и пакетов услуг</p>
<table class="rates"><thead><tr><th>Валюта</th><th>Сумма операции</th><th>Покупка, ₽</th><th>Продажа, ₽</th></tr></thead>
<tbody>
<tr><td rowspan="3">Доллар США (USD)</td><td>до 10&nbsp;000</td><td>79,50</td><td>84,25</td></tr>
<tr><td>от 10&nbsp;000 до 100&nbsp;000</td><td>79,90</td><td>83,95</td></tr>
<tr><td>свыше 100&nbsp;000</td><td>80,10</td><td>83,70</td></tr>
<tr><td rowspan="2">Евро (EUR)</td><td>до 10&nbsp;000</td><td>87,00</td><td>93,40</td></tr>
<tr><td>свыше 10&nbsp;000</td><td>87,40</td><td>93,00</td></tr>
<tr><td rowspan="2">Китайский юань (CNY)</td><td>до 10 000</td><td>10,90</td><td>11,85</td></tr>
<tr><td>свыше 10 000</td><td>11,00</td><td>11,70</td></tr>
</tbody></table>
<p>Курс ЦБ РФ на сегодня: USD 81,50</p>
</body></html>`;

/** HTML: диапазоны в объединённых заголовках колонок, под ними «Покупка/Продажа». */
export const HTML_TABLE_COLUMNS = `<div class="exchange">
<div class="tabs"><span class="active">В ВТБ Онлайн (и в офисе безналично)</span></div>
<table>
<caption>Без подписок и пакетов услуг</caption>
<tr><th rowspan="2">Валюта</th><th colspan="2">от 10 000 до 100 000</th><th colspan="2">до 10 000</th></tr>
<tr><th>Покупка</th><th>Продажа</th><th>Покупка</th><th>Продажа</th></tr>
<tr><td>USD</td><td>79,90</td><td>83,95</td><td>79,50</td><td>84,25</td></tr>
<tr><td>EUR</td><td>87,40</td><td>93,00</td><td>87,00</td><td>93,40</td></tr>
<tr><td>CNY</td><td>11,00</td><td>11,70</td><td>10,90</td><td>11,85</td></tr>
</table></div>`;

/** Ответы, в которых курсов нет. */
export const FOREIGN = {
  empty: '',
  spaces: '   \n  ',
  text: 'Service Unavailable',
  json: '{"status":"ok","items":[],"message":"USD"}',
  spa: '<!DOCTYPE html><html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>',
  cbTable: '<table><tr><th>Валюта</th><th>Курс ЦБ</th></tr><tr><td>USD</td><td>81,50</td></tr><tr><td>EUR</td><td>90,10</td></tr></table>',
  otherCurrencies: '<table><tr><th>Валюта</th><th>Покупка</th><th>Продажа</th></tr><tr><td>GBP</td><td>101,00</td><td>109,00</td></tr></table>',
  captcha: '<html><body><form action="/captcha"><p>Подтвердите, что вы не робот</p></form></body></html>',
};
