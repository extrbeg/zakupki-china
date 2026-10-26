import { describe, expect, it } from 'vitest';
import { newId } from '../../src/domain/ids';

describe('newId', () => {
  it('префикс + base36 времени + 4 случайных символа', () => {
    const id = newId('ord');
    expect(id).toMatch(/^ord_[0-9a-z]+[0-9a-z]{4}$/);
    const body = id.slice('ord_'.length);
    const timePart = body.slice(0, -4);
    const t = parseInt(timePart, 36);
    expect(Math.abs(t - Date.now())).toBeLessThan(5000);
  });

  it('не повторяется в серии вызовов', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId('l')));
    expect(ids.size).toBe(2000);
  });
});
