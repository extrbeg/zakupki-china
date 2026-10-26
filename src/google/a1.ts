// Нотация A1 для Sheets API: имена листов с пробелами и кириллицей берутся в кавычки.

/** 'Лист' с удвоенными одинарными кавычками внутри. */
export function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Индекс колонки с нуля → буквы: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Диапазон листа: a1('Заказы', 'A1:C3') → 'Заказы'!A1:C3; без части — весь лист. */
export function a1(sheet: string, part?: string): string {
  return part ? `${quoteSheet(sheet)}!${part}` : quoteSheet(sheet);
}

/** Прямоугольник по номерам строк (с 1) и индексам колонок (с 0). */
export function rect(sheet: string, row1: number, col1: number, row2: number, col2: number): string {
  return a1(sheet, `${columnLetter(col1)}${row1}:${columnLetter(col2)}${row2}`);
}
