/**
 * Скрипт таблицы «Закупки Китай».
 *
 * Ставится в таблицу пользователя приложением (Apps Script API). Делает три вещи:
 *  1) меню «Закупки» в таблице;
 *  2) ежедневная загрузка курсов продажи ВТБ (USD, EUR, CNY; «В ВТБ Онлайн (и в офисе безналично)»,
 *     «Без подписок и пакетов услуг», диапазон «до 10 000») в лист «Курсы»;
 *  3) ошибки и диагностика источника — в лист «Лог».
 *
 * Листы и заголовки — как в схеме приложения (src/store/schema.ts): колонки ищутся по заголовкам.
 * Даты в «Курсы» пишутся объектами Date (полночь по часовому поясу таблицы) с форматом даты,
 * время загрузки и время записи лога — Date с форматом даты-времени.
 *
 * Формат ответа сайта ВТБ заранее не проверен (с машины разработки сайт недоступен), поэтому разбор
 * терпим к нескольким форматам: JSON (отдельный ответ или встроенный в страницу) и HTML-таблица.
 * Если курсы не находятся — «Закупки → Проверить источник курсов» и прислать содержимое листа «Лог».
 */

// ───────────────────────── Настройки скрипта ─────────────────────────

var TZ_ = 'Europe/Moscow';
var DEFAULT_RATES_URL_ = 'https://www.vtb.ru/personal/platezhi-i-perevody/obmen-valjuty/';
var RATES_URL_SETTING_ = 'ratesSourceUrl';
var RATE_CURRENCIES_ = ['USD', 'EUR', 'CNY'];
var RATE_SOURCE_ = 'vtb';

var RATES_SHEET_ = 'Курсы';
var SETTINGS_SHEET_ = 'Настройки';
var LOG_SHEET_ = 'Лог';
// [ключ, заголовок] — порядок как в схеме приложения (приложение читает лист по позиции колонок)
var RATES_COLUMNS_ = [['id', 'id'], ['date', 'Дата'], ['currency', 'Валюта'], ['rate', 'Курс'], ['source', 'Источник'], ['loadedAt', 'Загружено'], ['comment', 'Комментарий']];
var SETTINGS_COLUMNS_ = [['key', 'Ключ'], ['value', 'Значение']];
var LOG_COLUMNS_ = [['time', 'Время'], ['level', 'Уровень'], ['message', 'Сообщение'], ['details', 'Подробности']];

var DAILY_HANDLER_ = 'fetchRatesDaily';
var DAILY_HOUR_ = 10;
var DATE_FORMAT_ = 'dd.mm.yyyy';
var DATETIME_FORMAT_ = 'dd.mm.yyyy hh:mm:ss';
var DIAG_BODY_CHARS_ = 5000;
var ERROR_BODY_CHARS_ = 1000;
var LOG_CELL_MAX_ = 45000;
var USER_AGENT_ = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ───────────────────────── Меню и точки входа ─────────────────────────

/** Простой триггер: меню «Закупки». */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Закупки')
    .addItem('Включить ежедневные курсы', 'enableDailyRates')
    .addItem('Обновить курсы сейчас', 'fetchRatesNow')
    .addSeparator()
    .addItem('Проверить источник курсов', 'diagnoseRatesSource')
    .addToUi();
}

/** Ставит ровно один ежедневный триггер ~10:00 МСК (повторный вызов не плодит) и сразу загружает курсы. */
function enableDailyRates() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === DAILY_HANDLER_; });
  if (existing.length === 0) {
    ScriptApp.newTrigger(DAILY_HANDLER_).timeBased().everyDays(1).atHour(DAILY_HOUR_).inTimezone(TZ_).create();
    log_('INFO', 'Ежедневная загрузка курсов включена (около ' + DAILY_HOUR_ + ':00 МСК)', '');
  } else if (existing.length > 1) {
    for (var i = 1; i < existing.length; i++) ScriptApp.deleteTrigger(existing[i]);
    log_('INFO', 'Убраны лишние триггеры ежедневных курсов: ' + (existing.length - 1), '');
  }
  return fetchRatesNow();
}

/** «Обновить курсы сейчас»: загружает сегодняшние курсы и перезаписывает сегодняшние vtb-строки. */
function fetchRatesNow() {
  return loadRates_(true);
}

/** Обработчик ежедневного триггера: сегодняшние vtb-строки, если уже есть, не перезаписывает. */
function fetchRatesDaily(e) { // eslint-disable-line no-unused-vars
  return loadRates_(false);
}

/** «Проверить источник курсов»: в «Лог» — URL, код ответа, content-type, первые 5000 символов, результат разбора. */
function diagnoseRatesSource() {
  var url = getRatesUrl_();
  var res = fetchSource_(url);
  if (res.error) {
    log_('ERROR', 'Проверка источника курсов: запрос не выполнен', 'URL: ' + url + '\nОшибка: ' + res.error);
    alert_('Источник курсов недоступен: ' + res.error + '\nПодробности — в листе «Лог».');
    return { ok: false, url: url, error: res.error };
  }
  var analysis = analyzeRatesBody_(res.body);
  var lines = [
    'URL: ' + url,
    'Код ответа: ' + res.code,
    'Content-Type: ' + (res.contentType || '—'),
    'Длина ответа: ' + res.body.length + ' символов',
    'JSON-блоков: ' + analysis.jsonBlocks + ', HTML-таблиц: ' + analysis.tables + ', кандидатов курса: ' + analysis.candidates.length,
    '',
    'Результат разбора (курс продажи, диапазон «до 10 000»):',
  ];
  RATE_CURRENCIES_.forEach(function (cur) {
    var picked = analysis.picked.filter(function (c) { return c.currency === cur; })[0];
    lines.push(picked ? describeCandidate_(picked) : cur + ': не найден');
  });
  if (analysis.candidates.length) {
    lines.push('', 'Все найденные кандидаты (до 40):');
    analysis.candidates.slice(0, 40).forEach(function (c) { lines.push('  ' + describeCandidate_(c)); });
  }
  var found = analysis.rates.length;
  var level = res.code === 200 && found === RATE_CURRENCIES_.length ? 'INFO' : (found ? 'WARN' : 'ERROR');
  log_(level, 'Проверка источника курсов: код ' + res.code + ', найдено курсов ' + found + ' из ' + RATE_CURRENCIES_.length, lines.join('\n'));
  log_('INFO', 'Начало ответа источника (первые ' + DIAG_BODY_CHARS_ + ' символов)', res.body.slice(0, DIAG_BODY_CHARS_));
  alert_('Проверка источника курсов: код ответа ' + res.code + ', найдено курсов ' + found + ' из ' + RATE_CURRENCIES_.length +
    '.\nРезультат и начало ответа записаны в лист «Лог».');
  return { ok: true, url: url, code: res.code, contentType: res.contentType, rates: analysis.rates };
}

// ───────────────────────── Загрузка курсов ─────────────────────────

function loadRates_(overwrite) {
  try {
    var today = todayIso_();
    var sheet = ensureSheet_(RATES_SHEET_, RATES_COLUMNS_);
    if (!overwrite) {
      var present = findRateRows_(sheet, today, RATE_SOURCE_).byCurrency;
      var missing = RATE_CURRENCIES_.filter(function (c) { return !present[c]; });
      if (!missing.length) return { ok: true, date: today, written: 0, skipped: RATE_CURRENCIES_.length, already: true };
    }
    var url = getRatesUrl_();
    var res = fetchSource_(url);
    if (res.error) {
      return fail_('network', 'Курсы ВТБ не загружены: источник недоступен', 'URL: ' + url + '\nОшибка: ' + res.error + hint_());
    }
    if (res.code !== 200) {
      return fail_('http', 'Курсы ВТБ не загружены: сайт ответил кодом ' + res.code,
        'URL: ' + url + '\nContent-Type: ' + (res.contentType || '—') + '\nНачало ответа:\n' + res.body.slice(0, ERROR_BODY_CHARS_) + hint_());
    }
    var rates = parseVtbRates_(res.body);
    if (!rates.length) {
      return fail_('parse', 'Курсы ВТБ не загружены: в ответе не найдены курсы продажи USD, EUR, CNY',
        'URL: ' + url + '\nКод ответа: ' + res.code + '\nContent-Type: ' + (res.contentType || '—') +
        '\nДлина ответа: ' + res.body.length + ' символов\nНачало ответа:\n' + res.body.slice(0, ERROR_BODY_CHARS_) + hint_());
    }
    var result = upsertRates_(sheet, today, rates, RATE_SOURCE_, overwrite);
    var notFound = RATE_CURRENCIES_.filter(function (c) { return !rates.some(function (r) { return r.currency === c; }); });
    if (notFound.length) {
      log_('WARN', 'Курсы ВТБ: не найдены ' + notFound.join(', '), 'URL: ' + url + hint_());
    }
    var summary = rates.map(function (r) { return r.currency + ' ' + r.rate; }).join(', ');
    log_('INFO', 'Курсы ВТБ на ' + today + ': ' + summary, 'Записано: ' + result.written + ', оставлено как было: ' + result.skipped + '\nURL: ' + url);
    notify_('Курсы ВТБ на ' + today + ': ' + summary);
    return { ok: true, date: today, rates: rates, written: result.written, skipped: result.skipped };
  } catch (err) {
    return fail_('error', 'Курсы ВТБ не загружены: ошибка скрипта', errorText_(err) + (err && err.stack ? '\n' + err.stack : ''));
  }
}

function fail_(reason, message, details) {
  log_('ERROR', message, details);
  notify_(message + '. Подробности — в листе «Лог».');
  return { ok: false, reason: reason, message: message };
}

function hint_() {
  return '\n\nЧто сделать: меню «Закупки → Проверить источник курсов» и прислать содержимое листа «Лог». ' +
    'Адрес источника можно сменить в листе «Настройки» (ключ ' + RATES_URL_SETTING_ + '). Пока курсы не грузятся — вводите их вручную на экране «Курсы».';
}

/**
 * Записывает курсы на дату: одна строка на (дата, валюта, источник), id `r_<дата>_<CUR>_<источник>`.
 * overwrite=false — существующие строки не трогает; overwrite=true — перезаписывает и убирает дубли.
 * @param {Sheet} sheet лист «Курсы»
 * @param {string} date ISO-дата YYYY-MM-DD
 * @param {{currency: string, rate: number}[]} rates
 * @param {string} source 'vtb'
 * @param {boolean} overwrite
 * @return {{written: number, skipped: number}}
 */
function upsertRates_(sheet, date, rates, source, overwrite) {
  var found = findRateRows_(sheet, date, source);
  var cols = found.cols;
  var width = Math.max(found.width, RATES_COLUMNS_.length);
  var tz = sheetTimeZone_();
  var dateValue = Utilities.parseDate(date, tz, 'yyyy-MM-dd');
  var loadedAt = now_();
  var nextRow = Math.max(sheet.getLastRow(), 1) + 1;
  var written = 0, skipped = 0, toDelete = [];

  rates.forEach(function (r) {
    var cur = normalizeCurrency_(r.currency);
    if (!cur || typeof r.rate !== 'number' || !isFinite(r.rate)) return;
    var rows = found.byCurrency[cur] || [];
    if (rows.length && !overwrite) { skipped++; return; }
    var rowNum, values;
    if (rows.length) {
      rowNum = rows[0];
      values = padRow_(found.values[rowNum - 2], width);
      toDelete = toDelete.concat(rows.slice(1));
    } else {
      rowNum = nextRow++;
      values = padRow_([], width);
    }
    values[cols.id - 1] = rateId_(date, cur, source);
    values[cols.date - 1] = dateValue;
    values[cols.currency - 1] = cur;
    values[cols.rate - 1] = r.rate;
    values[cols.source - 1] = source;
    values[cols.loadedAt - 1] = loadedAt;
    sheet.getRange(rowNum, 1, 1, width).setValues([values]);
    sheet.getRange(rowNum, cols.date).setNumberFormat(DATE_FORMAT_);
    sheet.getRange(rowNum, cols.loadedAt).setNumberFormat(DATETIME_FORMAT_);
    written++;
  });

  toDelete.sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });
  return { written: written, skipped: skipped };
}

/** Строки листа «Курсы» на дату и источник: по id или по (дата, валюта, источник). */
function findRateRows_(sheet, date, source) {
  var cols = ensureColumns_(sheet, RATES_COLUMNS_);
  var width = Math.max(sheet.getLastColumn(), RATES_COLUMNS_.length);
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  var tz = sheetTimeZone_();
  var byCurrency = {};
  values.forEach(function (row, i) {
    var id = String(row[cols.id - 1] == null ? '' : row[cols.id - 1]).trim();
    var cur = normalizeCurrency_(row[cols.currency - 1]);
    var src = String(row[cols.source - 1] == null ? '' : row[cols.source - 1]).trim().toLowerCase();
    var sameDay = cellToIso_(row[cols.date - 1], tz) === date && src === source;
    RATE_CURRENCIES_.forEach(function (c) {
      if (id === rateId_(date, c, source) || (sameDay && cur === c)) (byCurrency[c] = byCurrency[c] || []).push(i + 2);
    });
  });
  return { cols: cols, width: width, values: values, byCurrency: byCurrency };
}

function rateId_(date, currency, source) {
  return 'r_' + date + '_' + currency + '_' + source;
}

function normalizeCurrency_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'RMB' || s === 'CNH') return 'CNY';
  return RATE_CURRENCIES_.indexOf(s) >= 0 ? s : null;
}

// ───────────────────────── Источник ─────────────────────────

function getRatesUrl_() {
  var sheet = spreadsheet_().getSheetByName(SETTINGS_SHEET_);
  var url = sheet ? readSetting_(sheet, RATES_URL_SETTING_) : '';
  return /^https?:\/\//i.test(url) ? url : DEFAULT_RATES_URL_;
}

function readSetting_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return '';
  var values = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), 2)).getValues();
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var kc = indexOfAny_(head, ['ключ', 'key']), vc = indexOfAny_(head, ['значение', 'value']), start = 1;
  if (kc < 0 || vc < 0) { kc = 0; vc = 1; start = 0; }
  for (var r = start; r < values.length; r++) {
    if (String(values[r][kc]).trim() === key) return String(values[r][vc] == null ? '' : values[r][vc]).trim();
  }
  return '';
}

/** GET источника; сетевые ошибки не бросает, а возвращает в поле error. */
function fetchSource_(url) {
  var res = { url: url, code: 0, contentType: '', body: '', error: '' };
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      validateHttpsCertificates: false,   // у ВТБ сертификат российского УЦ
      followRedirects: true,
      headers: {
        'User-Agent': USER_AGENT_,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
      },
    });
    res.code = resp.getResponseCode();
    res.contentType = headerValue_(resp.getHeaders(), 'content-type');
    res.body = String(resp.getContentText() || '');
  } catch (err) {
    res.error = errorText_(err);
  }
  return res;
}

function headerValue_(headers, name) {
  if (!headers) return '';
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(headers[keys[i]]);
  return '';
}

// ───────────────────────── Разбор ответа ВТБ ─────────────────────────

/**
 * Чистая функция: из ответа источника — курсы продажи (банк продаёт валюту клиенту; больший из пары
 * покупка/продажа) для диапазона «до 10 000» по USD, EUR, CNY. Сначала JSON (весь ответ, <script>,
 * data-атрибуты, JSON внутри строк), затем HTML-таблицы. Ничего не нашла — [].
 * @param {string} body
 * @return {{currency: string, rate: number}[]}
 */
function parseVtbRates_(body) {
  return analyzeRatesBody_(body).rates;
}

function analyzeRatesBody_(body) {
  var text = body == null ? '' : String(body);
  var out = { rates: [], picked: [], candidates: [], jsonBlocks: 0, tables: 0 };
  if (!/\S/.test(text)) return out;
  var budget = { chars: 20000000, nodes: 300000 };

  var jsonCands = [], htmlStrings = [];
  var blocks = findJsonBlocks_(text, budget);
  out.jsonBlocks = blocks.length;
  blocks.forEach(function (b) { walkJson_(b, { currency: null, range: null, context: '' }, 0, 0, jsonCands, htmlStrings, budget); });

  var tables = extractTables_(text);
  htmlStrings.forEach(function (h) {
    extractTables_(h.html).forEach(function (t) { t.context = joinContext_(h.context, t.context); tables.push(t); });
  });
  out.tables = tables.length;
  var htmlCands = [];
  tables.forEach(function (t) { collectTableCandidates_(t, htmlCands); });

  out.candidates = jsonCands.concat(htmlCands);
  RATE_CURRENCIES_.forEach(function (cur) {
    var best = bestCandidate_(jsonCands, cur) || bestCandidate_(htmlCands, cur);
    if (best) { out.rates.push({ currency: cur, rate: best.rate }); out.picked.push(best); }
  });
  return out;
}

function addCandidate_(out, currency, buy, sell, range, context, via) {
  if (out.length >= 5000 || !validRate_(sell)) return;
  if (!validRate_(buy)) buy = null;
  out.push({
    currency: currency, buy: buy, sell: sell, rate: buy === null ? sell : Math.max(buy, sell),
    range: range || null, context: context || '', via: via,
    rangeScore: rangeScore_(range), contextScore: contextScore_(context),
  });
}

function validRate_(v) {
  return typeof v === 'number' && isFinite(v) && v > 0 && v < 100000;
}

/** Лучший кандидат валюты: сначала диапазон «до 10 000», затем условия «онлайн, без подписок»; при равенстве — первый. */
function bestCandidate_(list, currency) {
  var best = null, bestScore = -Infinity;
  list.forEach(function (c) {
    if (c.currency !== currency || c.rangeScore < 0) return;
    var score = c.rangeScore * 10 + c.contextScore;
    if (score > bestScore) { best = c; bestScore = score; }
  });
  return best;
}

/** 3 — «до 10 000»; 2 — «от N до 10 000»; 1 — диапазон с нуля шире 10 000; 0 — без диапазона; -1 — не подходит. */
function rangeScore_(r) {
  if (!r) return 0;
  var lo = r[0], hi = r[1], top = hi >= 9999 && hi <= 10000.01;
  if (lo <= 1 && top) return 3;
  if (lo < 9999 && top) return 2;
  if (lo <= 1 && hi > 10000.01) return 1;
  return -1;
}

/** Баллы условий: «ВТБ Онлайн / безналично», «без подписок и пакетов» — плюс; наличные, подписки, ЦБ, карты — минус. */
function contextScore_(context) {
  var s = String(context || '').toLowerCase();
  var score = 0;
  if (/онлайн|online|безнал|дистанц|интернет|internet|мобильн|mobile/.test(s)) score += 2;
  if (/(^|[^з])наличн|cash/.test(s)) score -= 3;
  if (/без\s+(подпис|пакет)/.test(s)) score += 2;
  var rest = s.replace(/без\s+(подпис[а-яё]*|пакет[а-яё]*)(\s+и\s+пакет[а-яё]*)?(\s+услуг)?/g, ' ');
  if (/подпис|пакет|привилег|прайм|prime|premium|privilege|мультибонус/.test(rest)) score -= 2;
  if (/(^|[^а-яё])цб([^а-яё]|$)|центральн|central|(^|[^a-z])cbr?([^a-z]|$)/.test(s)) score -= 3;
  if (/карт|card/.test(s)) score -= 1;
  return score;
}

function describeCandidate_(c) {
  var fmt = function (v) { return v === null || v === undefined ? '—' : String(v); };
  var where = c.via === 'json' ? 'JSON' : 'HTML-таблица';
  var ctx = String(c.context || '').replace(/\s+/g, ' ').trim();
  if (ctx.length > 160) ctx = '…' + ctx.slice(-160);
  return c.currency + ': ' + c.rate + ' (покупка ' + fmt(c.buy) + ', продажа ' + fmt(c.sell) + '; диапазон ' + formatRange_(c.range) +
    '; где: ' + where + '; условия: ' + (ctx || '—') + ')';
}

function formatRange_(r) {
  if (!r) return 'не указан';
  return (r[0] === 0 ? '0' : String(r[0])) + '–' + (r[1] === Infinity ? '∞' : String(r[1]));
}

// ── JSON ──

/** Все JSON-значения, которые удалось найти в ответе. */
function findJsonBlocks_(text, budget) {
  var trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) {
    try { return [JSON.parse(trimmed)]; } catch (e) { /* не целиком JSON — ищем куски */ }
  }
  var sources = [];
  if (/<(html|head|body|script|div|table)\b/i.test(text)) {
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(text))) {
      if (/\bsrc\s*=/i.test(m[1]) || !/\S/.test(m[2])) continue;
      if (/json/i.test(m[1])) sources.unshift(m[2]); else sources.push(m[2]); // JSON-скрипты — первыми
    }
    var attrRe = /=\s*(["'])(\s*[\[{]\s*&quot;[\s\S]*?)\1/g;
    while ((m = attrRe.exec(text))) sources.push(decodeEntities_(m[2]));
  } else {
    sources.push(text);
  }
  var blocks = [];
  sources.forEach(function (s) { scanJson_(s, budget).forEach(function (b) { blocks.push(b); }); });
  return blocks;
}

/** Ищет в тексте JSON-объекты и массивы (`{"…` или `[{…`), учитывая строки и вложенность. */
function scanJson_(s, budget) {
  var out = [];
  var t = s.trim();
  if (/^[\[{]/.test(t)) {
    try { out.push(JSON.parse(t)); return out; } catch (e) { /* ищем куски */ }
  }
  var re = /[\[{]/g, m, attempts = 0;
  while ((m = re.exec(s)) && attempts < 5000 && budget.chars > 0) {
    var i = m.index;
    if (!jsonStartAt_(s, i)) continue;
    attempts++;
    var end = matchJsonEnd_(s, i, budget);
    if (end > i) {
      try { out.push(JSON.parse(s.slice(i, end + 1))); re.lastIndex = end + 1; } catch (e) { /* не JSON */ }
    }
  }
  return out;
}

function jsonStartAt_(s, i) {
  var j = i + 1;
  while (j < s.length && /\s/.test(s.charAt(j))) j++;
  var c = s.charAt(j);
  if (s.charAt(i) === '{') return c === '"';
  return c === '{' || c === '[' || c === '"' || /[0-9\-]/.test(c);
}

function matchJsonEnd_(s, i, budget) {
  var depth = 0, inStr = false, n = s.length, j;
  for (j = i; j < n; j++) {
    var c = s.charAt(j);
    if (inStr) {
      if (c === '\\') j++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) { budget.chars -= (j - i); return j; }
      if (depth < 0) break;
    }
  }
  budget.chars -= (j - i);
  return -1;
}

/** Обходит JSON; валюта, диапазон и условия наследуются от родительских объектов. */
function walkJson_(node, inh, depth, nest, out, htmlStrings, budget) {
  if (depth > 80 || --budget.nodes < 0) return;
  if (typeof node === 'string') {
    if (node.length > 40 && nest < 3) {
      if (node.indexOf('{"') >= 0 || /^\s*\[/.test(node)) {
        scanJson_(node, budget).forEach(function (b) { walkJson_(b, inh, depth + 1, nest + 1, out, htmlStrings, budget); });
      }
      if (/<table\b/i.test(node)) htmlStrings.push({ html: node, context: inh.context });
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (var k = 0; k < node.length; k++) walkJson_(node[k], inh, depth + 1, nest, out, htmlStrings, budget);
    return;
  }
  var info = inspectObject_(node);
  var ctx = {
    currency: info.ambiguous ? null : (info.currency || inh.currency),
    range: info.range || inh.range,
    context: joinContext_(inh.context, info.context),
  };
  if (ctx.currency && info.sell !== null) {
    addCandidate_(out, ctx.currency, info.buy, info.sell, ctx.range, ctx.context, 'json');
  }
  Object.keys(node).forEach(function (key) {
    var child = node[key];
    if (child === null || (typeof child !== 'object' && typeof child !== 'string')) return;
    var keyRange = /\d/.test(key) ? parseRangeText_(key, false) : null;
    walkJson_(child, {
      currency: currencyFromKey_(key) || ctx.currency,
      range: keyRange || ctx.range,
      context: joinContext_(ctx.context, key),
    }, depth + 1, nest, out, htmlStrings, budget);
  });
}

var SELL_TOKENS_ = ['sell', 'sale', 'sales', 'selling', 'offer', 'ask'];
var BUY_TOKENS_ = ['buy', 'buying', 'purchase', 'bid'];
var LOW_TOKENS_ = ['from', 'min', 'minimum', 'start', 'lower', 'low', 'ot'];
var HIGH_TOKENS_ = ['to', 'max', 'maximum', 'end', 'upper', 'high', 'till', 'until', 'do'];
var AMOUNT_TOKENS_ = ['amount', 'sum', 'summa', 'balance', 'value', 'limit', 'range', 'bound', 'volume', 'qty', 'quantity'];
var EXCLUDE_NUM_TOKENS_ = ['change', 'diff', 'delta', 'prev', 'previous', 'old', 'percent', 'pct', 'trend', 'dynamic', 'dynamics',
  'cb', 'cbr', 'central', 'official', 'spread', 'margin', 'date', 'time', 'id', 'code', 'count', 'index', 'order', 'sort', 'scale', 'nominal'];
var CURRENCY_KEY_TOKENS_ = ['currency', 'cur', 'curr', 'ccy', 'valuta', 'valyuta', 'валюта', 'code', 'iso', 'symbol', 'name', 'title', 'label',
  'alpha', 'char', 'charcode', 'from', 'to', 'base', 'quote', 'target'];
var CURRENCY_SUB_TOKENS_ = ['code', 'iso', 'name', 'title', 'symbol', 'alpha', 'char', 'charcode', 'currency', 'cur', 'short', 'label'];
var CONTEXT_KEY_TOKENS_ = ['title', 'subtitle', 'name', 'label', 'caption', 'header', 'heading', 'description', 'desc', 'text', 'group', 'category',
  'type', 'place', 'tab', 'channel', 'kind', 'tariff', 'package', 'segment', 'conversion', 'condition', 'conditions', 'mode', 'operation', 'service', 'product'];
var RANGE_KEY_TOKENS_ = ['range', 'amount', 'sum', 'limit', 'interval', 'bound', 'volume', 'диапазон', 'сумма', 'label', 'title', 'name', 'text', 'caption', 'header'];

/** Разбирает собственные поля объекта: валюта, покупка, продажа, диапазон, тексты условий. */
function inspectObject_(obj) {
  var info = { currency: null, ambiguous: false, buy: null, sell: null, range: null, context: '' };
  var curs = {}, lo = null, hi = null, textRange = null, ctxParts = [];
  var addCur = function (c) { if (c) curs[c] = true; };
  Object.keys(obj).forEach(function (key) {
    var v = obj[key];
    var tokens = keyTokens_(key);
    if (typeof v === 'string' || typeof v === 'number') {
      if (hasAny_(tokens, CURRENCY_KEY_TOKENS_)) addCur(currencyFromText_(String(v)));
      var num = toNumber_(v);
      if (num !== null && !hasAny_(tokens, EXCLUDE_NUM_TOKENS_)) {
        if (isSell_(tokens)) { if (info.sell === null) info.sell = num; }
        else if (isBuy_(tokens)) { if (info.buy === null) info.buy = num; }
        else if (isBound_(tokens, LOW_TOKENS_)) { if (lo === null) lo = num; }
        else if (isBound_(tokens, HIGH_TOKENS_)) { if (hi === null) hi = num; }
      }
      if (typeof v === 'string') {
        if (!textRange && v.length <= 80 && /\d/.test(v) && !hasAny_(tokens, ['date', 'time'])) {
          textRange = parseRangeText_(v, hasAny_(tokens, RANGE_KEY_TOKENS_));
        }
        if (v.length <= 200 && hasAny_(tokens, CONTEXT_KEY_TOKENS_)) ctxParts.push(v);
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v) && hasAny_(tokens, CURRENCY_KEY_TOKENS_)) {
      Object.keys(v).forEach(function (k2) {
        if (typeof v[k2] === 'string' && hasAny_(keyTokens_(k2), CURRENCY_SUB_TOKENS_)) addCur(currencyFromText_(v[k2]));
      });
    }
  });
  var found = Object.keys(curs);
  if (found.length === 1) info.currency = found[0];
  else if (found.length > 1) info.ambiguous = true;
  info.range = (lo !== null || hi !== null) ? boundsRange_(lo, hi) : textRange;
  info.context = ctxParts.join(' ');
  return info;
}

function isSell_(tokens) {
  return tokens.some(function (t) { return SELL_TOKENS_.indexOf(t) >= 0 || t.indexOf('продаж') === 0; });
}
function isBuy_(tokens) {
  return tokens.some(function (t) { return BUY_TOKENS_.indexOf(t) >= 0 || t.indexOf('покуп') === 0; });
}
/** Граница диапазона: ключ из одного слова (`min`) или слово границы вместе со словом суммы (`amountFrom`, `EndBalance`). */
function isBound_(tokens, words) {
  if (!hasAny_(tokens, words)) return false;
  return tokens.length === 1 || hasAny_(tokens, AMOUNT_TOKENS_);
}

function boundsRange_(lo, hi) {
  if (lo === null) lo = 0;
  if (hi === null || (hi === 0 && lo > 0)) hi = Infinity;
  return validRange_(lo, hi);
}

/** `BankSellAt` → ['bank','sell','at']; `amount_from` → ['amount','from']. */
function keyTokens_(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-zа-яё0-9]+/).filter(function (t) { return t; });
}

function hasAny_(tokens, words) {
  for (var i = 0; i < tokens.length; i++) if (words.indexOf(tokens[i]) >= 0) return true;
  return false;
}

// ── HTML ──

/** Таблицы ответа с текстом перед каждой (заголовки, вкладки — до предыдущей таблицы) и подписью. */
function extractTables_(html) {
  var out = [], re = /<table\b[\s\S]*?<\/table>/gi, m, prevEnd = 0;
  while ((m = re.exec(html))) {
    var from = Math.max(prevEnd, m.index - 2000);
    var raw = html.slice(from, m.index);
    if (from > prevEnd) raw = raw.replace(/^[^<]*>/, ''); // хвост тега, разрезанного на границе куска
    var before = htmlToText_(raw);
    var cap = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(m[0]);
    out.push({ html: m[0], context: before.slice(-300) + (cap ? ' ' + htmlToText_(cap[1]) : '') });
    prevEnd = m.index + m[0].length;
  }
  return out;
}

/** Таблица → сетка ячеек с учётом colspan/rowspan (объединённая ячейка повторяется во всех клетках). */
function parseTableGrid_(tableHtml) {
  var grid = [], spans = [];
  var rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>)/gi, rm;
  while ((rm = rowRe.exec(tableHtml))) {
    var rowHtml = rm[1], line = [], col = 0;
    var fillSpans = function () {
      while (spans[col] && spans[col].left > 0) {
        line[col] = { text: spans[col].text, th: spans[col].th };
        spans[col].left--;
        col++;
      }
    };
    var cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)(?=<\/?(?:td|th|tr)\b|<\/table>|$)/gi, cm;
    while ((cm = cellRe.exec(rowHtml))) {
      fillSpans();
      var th = cm[1].toLowerCase() === 'th';
      var text = htmlToText_(cm[3]);
      var cs = Math.min(parseInt((/colspan\s*=\s*["']?(\d+)/i.exec(cm[2]) || [0, '1'])[1], 10) || 1, 50);
      var rs = Math.min(parseInt((/rowspan\s*=\s*["']?(\d+)/i.exec(cm[2]) || [0, '1'])[1], 10) || 1, 500);
      for (var k = 0; k < cs; k++) {
        line[col] = { text: text, th: th };
        if (rs > 1) spans[col] = { text: text, th: th, left: rs - 1 };
        col++;
      }
    }
    fillSpans();
    for (var j = 0; j < line.length; j++) if (!line[j]) line[j] = { text: '', th: false };
    if (line.length) grid.push(line);
  }
  return grid;
}

/** Кандидаты из таблицы: колонки «покупка/продажа» по заголовкам; диапазон — в ячейке строки или в заголовке колонки. */
function collectTableCandidates_(table, out) {
  var grid = parseTableGrid_(table.html);
  if (grid.length < 2) return;
  var width = 0;
  grid.forEach(function (r) { width = Math.max(width, r.length); });
  var head = 0;
  while (head < grid.length - 1 && head < 4 && !grid[head].some(function (c) { return toNumber_(c.text) !== null; })) head++;
  if (head === 0) return;

  var labels = [], kinds = [], colRanges = [], colCurs = [];
  for (var j = 0; j < width; j++) {
    var parts = [];
    for (var h = 0; h < head; h++) {
      var t = grid[h][j] ? grid[h][j].text : '';
      if (t && parts.indexOf(t) < 0) parts.push(t);
    }
    labels[j] = parts.join(' ');
    kinds[j] = sideFromText_(labels[j]);
    colRanges[j] = /\d/.test(labels[j]) ? parseRangeText_(labels[j], false) : null;
    colCurs[j] = currencyFromText_(labels[j]);
  }
  if (!kinds.some(function (k) { return k; })) return;

  var lastCur = null;
  for (var r = head; r < grid.length; r++) {
    var row = grid[r], rowCur = null, rowRange = null;
    row.forEach(function (c, j2) {
      if (kinds[j2]) return;
      if (!rowCur) rowCur = currencyFromText_(c.text);
      if (!rowRange && /\d/.test(c.text) && toNumber_(c.text) === null) rowRange = parseRangeText_(c.text, true);
    });
    if (!rowCur && row[0] && !row[0].text) rowCur = lastCur;
    if (rowCur) lastCur = rowCur;

    var groups = {}, order = [];
    row.forEach(function (c, j3) {
      if (!kinds[j3]) return;
      var num = toNumber_(c.text);
      if (num === null) return;
      var cur = colCurs[j3] || rowCur;
      if (!cur) return;
      var range = colRanges[j3] || rowRange;
      var label = stripSide_(labels[j3]);
      var key = cur + '|' + label + '|' + (range ? range.join('-') : '');
      if (!groups[key]) { groups[key] = { cur: cur, range: range, label: label, buy: null, sell: null }; order.push(key); }
      var g = groups[key];
      if (kinds[j3] === 'sell' && g.sell === null) g.sell = num;
      else if (kinds[j3] === 'buy' && g.buy === null) g.buy = num;
    });
    order.forEach(function (key) {
      var g = groups[key];
      if (g.sell !== null) addCandidate_(out, g.cur, g.buy, g.sell, g.range, joinContext_(table.context, g.label), 'html');
    });
  }
}

function sideFromText_(label) {
  var s = String(label || '').toLowerCase();
  if (/(^|[^а-яё])цб([^а-яё]|$)|центральн|central|(^|[^a-z])cbr?([^a-z]|$)/.test(s)) return null;
  var sell = /продаж|sell|sale/.test(s), buy = /покуп|buy/.test(s);
  if (sell && !buy) return 'sell';
  if (buy && !sell) return 'buy';
  return null;
}

function stripSide_(label) {
  return String(label || '').replace(/покупк[а-яё]*|продаж[а-яё]*|buying|buy|selling|sell|sale/gi, ' ')
    .replace(/[,;:\s₽]+/g, ' ').trim();
}

function htmlToText_(html) {
  var s = String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities_(s).replace(/[\s   ]+/g, ' ').trim();
}

function decodeEntities_(s) {
  var named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', ndash: '–', mdash: '—',
    thinsp: ' ', ensp: ' ', emsp: ' ', hellip: '…', minus: '-', rub: '₽' };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, code) {
    if (code.charAt(0) === '#') {
      var n = code.charAt(1).toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!isFinite(n) || n <= 0 || n > 0x10ffff) return all;
      return n === 160 ? ' ' : String.fromCodePoint(n);
    }
    var v = named[code.toLowerCase()];
    return v === undefined ? all : v;
  });
}

// ── Общие разборщики ──

/** Валюта из короткого текста: код или название; несколько валют или длинный текст → null. */
function currencyFromText_(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (!s || s.length > 40) return null;
  var up = s.toUpperCase();
  if (/^(USD|EUR|CNY|RMB|CNH)$/.test(up)) return up === 'RMB' || up === 'CNH' ? 'CNY' : up;
  var found = {}, m, re = /(^|[^A-Z])(USD|EUR|CNY|RMB|CNH)(?![A-Z])/g;
  while ((m = re.exec(up))) found[m[2] === 'RMB' || m[2] === 'CNH' ? 'CNY' : m[2]] = true;
  var low = s.toLowerCase();
  if (/доллар[а-яё]*\s+сша|u\.?\s?s\.?\s+dollar|us\s*dollar/.test(low)) found.USD = true;
  if (/(^|[^а-яё])евро([^а-яё]|$)|(^|[^a-z])euro?s?([^a-z]|$)/.test(low)) found.EUR = true;
  if (/юан|yuan|renminbi|жэньминьби/.test(low)) found.CNY = true;
  var keys = Object.keys(found);
  return keys.length === 1 ? keys[0] : null;
}

function currencyFromKey_(key) {
  var k = String(key).trim().toUpperCase();
  if (k === 'RMB' || k === 'CNH') return 'CNY';
  return RATE_CURRENCIES_.indexOf(k) >= 0 ? k : null;
}

/** Число из числа или строки вида «84,50», «10 000», «84.5 ₽»; иначе null. */
function toNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  var s = v.replace(/[\s   ]/g, '').replace(/₽|руб\.?|rub/gi, '');
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
}

/**
 * Диапазон суммы из текста: «до 10 000» → [0, 10000]; «от 10 000 до 100 000» → [10000, 100000];
 * «свыше 100 000» → [100000, ∞]; «0 – 10 000» → [0, 10000] (только при allowDash). Иначе null.
 */
function parseRangeText_(text, allowDash) {
  var t = String(text).toLowerCase().replace(/[   ]/g, ' ');
  var prev;
  do { prev = t; t = t.replace(/(\d) (\d{3})(?!\d)/g, '$1$2'); } while (t !== prev);
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:тыс\.?|тысяч[а-яё]*|k)(?![a-zа-яё])/g, function (a, n) { return String(parseFloat(n) * 1000); });
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:млн\.?|миллион[а-яё]*)(?![a-zа-яё])/g, function (a, n) { return String(parseFloat(n) * 1000000); });
  var N = '(\\d+(?:\\.\\d+)?)', W = '(?:^|[^а-яёa-z])', m;
  if ((m = new RegExp(W + '(?:от|from)\\s*' + N + '\\s*(?:до|to|-|–|—)\\s*' + N).exec(t))) return validRange_(+m[1], +m[2]);
  if ((m = new RegExp(W + '(?:до|up\\s*to|не\\s*более|менее|less\\s*than|<=?|≤)\\s*' + N).exec(t))) return validRange_(0, +m[1]);
  if ((m = new RegExp(W + '(?:от|свыше|более|больше|from|over|above|more\\s*than|>=?|≥)\\s*' + N).exec(t))) return validRange_(+m[1], Infinity);
  if (allowDash && (m = new RegExp('^\\s*' + N + '\\s*(?:-|–|—|\\.\\.\\.?)\\s*' + N + '\\s*$').exec(t))) return validRange_(+m[1], +m[2]);
  return null;
}

function validRange_(lo, hi) {
  if (!(lo >= 0) || !(hi > lo)) return null;
  return [lo, hi];
}

function joinContext_(a, b) {
  var s = a && b ? a + ' | ' + b : (a || b || '');
  return s.length > 600 ? s.slice(-600) : s;
}

// ───────────────────────── Листы, лог, служебное ─────────────────────────

function now_() {
  return new Date();
}

function todayIso_() {
  return Utilities.formatDate(now_(), TZ_, 'yyyy-MM-dd');
}

function spreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheetTimeZone_() {
  try { return spreadsheet_().getSpreadsheetTimeZone() || TZ_; } catch (e) { return TZ_; }
}

function ensureSheet_(name, columns) {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    try { sheet.setFrozenRows(1); } catch (e) { /* не критично */ }
  }
  ensureColumns_(sheet, columns);
  return sheet;
}

/** Номера колонок по заголовкам первой строки; недостающие заголовки дописывает справа. */
function ensureColumns_(sheet, columns) {
  var width = sheet.getLastColumn();
  var header = width > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  var norm = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var map = {}, next = width;
  columns.forEach(function (c) {
    var i = indexOfAny_(norm, [c[1].toLowerCase(), c[0].toLowerCase()]);
    if (i >= 0) { map[c[0]] = i + 1; return; }
    next += 1;
    sheet.getRange(1, next).setValue(c[1]);
    map[c[0]] = next;
  });
  return map;
}

/** Строка в лист «Лог»: время (Date), уровень, сообщение, подробности. Сбой записи лога не роняет скрипт. */
function log_(level, message, details) {
  try {
    var sheet = ensureSheet_(LOG_SHEET_, LOG_COLUMNS_);
    var cols = ensureColumns_(sheet, LOG_COLUMNS_);
    var width = Math.max(sheet.getLastColumn(), LOG_COLUMNS_.length);
    var row = padRow_([], width);
    row[cols.time - 1] = now_();
    row[cols.level - 1] = level;
    row[cols.message - 1] = cellText_(message);
    row[cols.details - 1] = cellText_(details);
    var r = Math.max(sheet.getLastRow(), 1) + 1;
    sheet.getRange(r, 1, 1, width).setValues([row]);
    sheet.getRange(r, cols.time).setNumberFormat(DATETIME_FORMAT_);
  } catch (err) {
    console.error('Не удалось записать в «Лог»: ' + errorText_(err));
  }
  console.log(level + ' ' + message);
}

/** Текст для ячейки: обрезка по лимиту ячейки; ведущие = + - @ экранируются, чтобы не стать формулой. */
function cellText_(s) {
  s = s === null || s === undefined ? '' : String(s);
  if (s.length > LOG_CELL_MAX_) s = s.slice(0, LOG_CELL_MAX_) + '\n…(обрезано)';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function notify_(message) {
  try { spreadsheet_().toast(message, 'Закупки', 10); } catch (e) { /* нет интерфейса — например, запуск из триггера */ }
}

function alert_(message) {
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { notify_(message); }
}

function cellToIso_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  var s = String(v === null || v === undefined ? '' : v).trim(), m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function padRow_(row, width) {
  var out = (row || []).slice(0, Math.max(width, (row || []).length));
  while (out.length < width) out.push('');
  return out;
}

function indexOfAny_(list, values) {
  for (var i = 0; i < values.length; i++) {
    var idx = list.indexOf(values[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function errorText_(err) {
  return err && err.message ? String(err.message) : String(err);
}
