// Поиск при вводе (история 93): совпадение по подстроке без учёта регистра, «ё/е», крайних и повторных пробелов.
// Чистые функции: их используют подсказки товаров (`productHints.ts`) и поля с подсказками в интерфейсе.

/** Подсказок в выпадающем списке — не больше. */
export const SUGGESTION_LIMIT = 10;

/** Ключ сравнения: без регистра, «ё» как «е», без крайних пробелов, повторные пробелы — один. */
export const searchKey = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Текст содержит запрос (пустой запрос подходит всем). */
export const matchesQuery = (text: string, query: string): boolean => searchKey(text).includes(searchKey(query));

/** Подходящие запросу элементы в исходном порядке, не больше `limit`. */
export function filterByQuery<T>(items: T[], text: (item: T) => string, query: string, limit = SUGGESTION_LIMIT): T[] {
  const key = searchKey(query);
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (!key || searchKey(text(item)).includes(key)) out.push(item);
  }
  return out;
}

/** Где в исходном тексте первое совпадение с запросом — `[начало, конец)`; нет или пустой запрос — null. */
export function matchRange(text: string, query: string): [number, number] | null {
  const key = searchKey(query);
  if (!key) return null;
  // посимвольная замена сохраняет позиции; повторные пробелы в тексте сводим к одному через регулярное выражение
  const lowered = text.toLowerCase().replace(/ё/g, 'е');
  if (lowered.length !== text.length) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const m = new RegExp(escaped).exec(lowered);
  return m ? [m.index, m.index + m[0].length] : null;
}
