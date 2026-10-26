import { describe, expect, it } from 'vitest';
import { getBinding, setBinding } from '../../src/setup/binding';

describe('привязка таблицы', () => {
  it('запоминается по email в localStorage `zk:binding:<email>` и снимается null', () => {
    expect(getBinding('a@example.com')).toBeNull();
    setBinding('a@example.com', 'sp_a');
    setBinding('b@example.com', 'sp_b');
    expect(localStorage.getItem('zk:binding:a@example.com')).toBe('sp_a');
    expect(getBinding('a@example.com')).toBe('sp_a');
    expect(getBinding('b@example.com')).toBe('sp_b');
    setBinding('a@example.com', null);
    expect(getBinding('a@example.com')).toBeNull();
    expect(getBinding('b@example.com')).toBe('sp_b');
  });
});
