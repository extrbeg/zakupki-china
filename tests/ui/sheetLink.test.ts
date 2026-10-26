// Разбор ссылки на Google-таблицу (G14, история 81): ссылка docs.google.com/spreadsheets/d/<id>/… или сам id → id.
import { describe, expect, it } from 'vitest';
import { parseSheetLink, SHEET_LINK_ERROR_TEXT, SheetLinkError } from '../../src/ui/sheetLink';

// Похоже на настоящий id таблицы: 44 символа из букв, цифр, «-» и «_».
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';

describe('parseSheetLink', () => {
  it.each([
    ['ссылка на редактирование', `https://docs.google.com/spreadsheets/d/${ID}/edit`],
    ['с #gid', `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456`],
    ['с ?usp', `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`],
    ['с ?usp и #gid', `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drive_link#gid=0`],
    ['без схемы', `docs.google.com/spreadsheets/d/${ID}/edit`],
    ['без хвоста', `https://docs.google.com/spreadsheets/d/${ID}`],
    ['со слешем в конце', `https://docs.google.com/spreadsheets/d/${ID}/`],
    ['аккаунт /u/1/', `https://docs.google.com/spreadsheets/u/1/d/${ID}/edit`],
    ['http', `http://docs.google.com/spreadsheets/d/${ID}/htmlview`],
    ['пробелы и перевод строки вокруг', `  https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0\n`],
    ['голый id', ID],
    ['голый id с пробелами', ` ${ID} `],
  ])('%s → id', (_name, text) => {
    expect(parseSheetLink(text)).toBe(ID);
  });

  it.each([
    ['пусто', ''],
    ['пробелы', '   '],
    ['слово', 'таблица'],
    ['короткое слово латиницей', 'abc'],
    ['документ, не таблица', `https://docs.google.com/document/d/${ID}/edit`],
    ['презентация', `https://docs.google.com/presentation/d/${ID}/edit`],
    ['файл на Диске', `https://drive.google.com/file/d/${ID}/view`],
    ['опубликованная в интернете (/d/e/…)', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc/pubhtml'],
    ['чужой сайт с таким же путём', `https://evil.example.com/spreadsheets/d/${ID}/edit`],
    ['поддомен-обманка', `https://docs.google.com.example.com/spreadsheets/d/${ID}/edit`],
    ['id с недопустимыми символами', `${ID.slice(0, 20)}!${ID.slice(21)}`],
  ])('%s → ошибка «Это не ссылка на Google-таблицу»', (_name, text) => {
    expect(() => parseSheetLink(text)).toThrow(SheetLinkError);
    expect(() => parseSheetLink(text)).toThrow('Это не ссылка на Google-таблицу');
  });

  it('текст ошибки — для показа у поля', () => {
    expect(SHEET_LINK_ERROR_TEXT).toBe('Это не ссылка на Google-таблицу');
  });
});
