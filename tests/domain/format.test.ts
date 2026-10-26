import { describe, expect, it } from 'vitest';
import { ruDate } from '../../src/domain/format';

describe('ruDate', () => {
  it('ISO → дд.мм.гггг; пусто — пустая строка; не дата — как есть', () => {
    expect(ruDate('2026-10-24')).toBe('24.10.2026');
    expect(ruDate(undefined)).toBe('');
    expect(ruDate('')).toBe('');
    expect(ruDate('завтра')).toBe('завтра');
  });
});
