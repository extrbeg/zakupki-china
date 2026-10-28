// Помощники тестов для полей с подсказками при вводе (SuggestInput, AddableSelect с поиском).
import { act, fireEvent, within } from '@testing-library/react';

/** Открытый список подсказок поля (role=listbox, на него указывает aria-controls). */
export function suggestionList(input: HTMLElement): HTMLElement {
  const id = input.getAttribute('aria-controls');
  const list = id ? document.getElementById(id) : null;
  if (!list) throw new Error(`Список подсказок поля не открыт: ${input.getAttribute('aria-label') ?? input.id}`);
  return list;
}

/** Видимые тексты подсказок (без служебного «+ Добавить…»). */
export const suggestionTexts = (input: HTMLElement): string[] =>
  within(suggestionList(input)).queryAllByRole('option').filter((o) => o.getAttribute('data-value') !== null).map((o) => o.textContent ?? '');

/** Значения подсказок (что подставит выбор). */
export const suggestionValues = (input: HTMLElement): string[] =>
  within(suggestionList(input)).queryAllByRole('option').map((o) => o.getAttribute('data-value')).filter((v): v is string => v !== null);

/** Фокус в поле, при необходимости ввод запроса, нажатие на подсказку с этим текстом. */
export function pickSuggestion(input: HTMLElement, option: string | RegExp, query?: string): void {
  act(() => input.focus());
  if (query !== undefined) fireEvent.change(input, { target: { value: query } });
  fireEvent.click(within(suggestionList(input)).getByRole('option', { name: option }));
}

/** Выбранное значение поля выбора с поиском (id записи справочника или значение). */
export const pickedValue = (input: HTMLElement): string => input.getAttribute('data-value') ?? '';

/** Выбор в поле с поиском по значению пункта (id записи): открыть список заново и нажать пункт; '' — снять выбор. */
export function pickByValue(input: HTMLElement, value: string): void {
  act(() => input.blur());
  if (value === '') { fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input); return; }
  act(() => input.focus());
  const option = within(suggestionList(input)).queryAllByRole('option').find((o) => o.getAttribute('data-value') === value);
  if (!option) throw new Error(`Нет пункта «${value}» в списке поля ${input.getAttribute('aria-label') ?? input.id}`);
  fireEvent.click(option);
}
