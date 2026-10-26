// Разбор поля «Ссылка на таблицу» (G14): ссылка docs.google.com/spreadsheets/d/<id>/… (с #gid, ?usp, без схемы)
// или сам id → id файла. Чистая функция: доступ к файлу даёт не ссылка, а выбор в окне Google (drive.file, ADR 0002).

export const SHEET_LINK_ERROR_TEXT = 'Это не ссылка на Google-таблицу';

export class SheetLinkError extends Error {
  constructor() {
    super(SHEET_LINK_ERROR_TEXT);
    this.name = 'SheetLinkError';
  }
}

/** id файла Google: буквы, цифры, «-» и «_»; у таблиц обычно 44 символа. Короче 20 — не id (слово, опечатка). */
const ID = '[A-Za-z0-9_-]{20,}';
const BARE_ID = new RegExp(`^${ID}$`);
// Хост — ровно docs.google.com; путь /spreadsheets[/u/<n>]/d/<id>, дальше «/», «?», «#» или конец строки.
const LINK = new RegExp(`^(?:https?://)?docs\\.google\\.com/spreadsheets/(?:u/\\d+/)?d/(${ID})(?:[/?#].*)?$`, 's');

/** id таблицы из ссылки или голого id; иначе SheetLinkError «Это не ссылка на Google-таблицу». */
export function parseSheetLink(text: string): string {
  const s = text.trim();
  if (BARE_ID.test(s)) return s;
  const m = LINK.exec(s);
  if (m) return m[1];
  throw new SheetLinkError();
}
