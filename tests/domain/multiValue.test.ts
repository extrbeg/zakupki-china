import { describe, expect, it } from 'vitest';
import { joinMultiValue, splitMultiValue } from '../../src/domain/multiValue';

describe('несколько значений в ячейке', () => {
  it('делит только по «;», без пустых и повторов; запятая остаётся в значении', () => {
    expect(splitMultiValue('Мебель; свет;;Свет ;Краски, лаки')).toEqual(['Мебель', 'свет', 'Краски, лаки']);
    expect(splitMultiValue(undefined)).toEqual([]);
  });

  it('собирает через «; »; пусто — undefined', () => {
    expect(joinMultiValue(['Мебель', ' Свет ', 'мебель'])).toBe('Мебель; Свет');
    expect(joinMultiValue([])).toBeUndefined();
  });
});
