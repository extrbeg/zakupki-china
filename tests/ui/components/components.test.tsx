import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TextField, NumberField, SelectField, DateField, CheckboxField, DataTable, ErrorBanner, EmptyState } from '../../../src/ui/components';
import { StoreError } from '../../../src/store/types';

describe('TextField', () => {
  it('показывает русскую ошибку под полем и не теряет введённое', () => {
    function Form() {
      const [v, setV] = useState('');
      return <TextField label="Заказчик" value={v} onChange={setV} error={v.length < 3 ? 'Минимум 3 символа' : undefined} />;
    }
    render(<Form />);
    const input = screen.getByLabelText('Заказчик') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'АБ' } });
    expect(input.value).toBe('АБ');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = screen.getByText('Минимум 3 символа');
    expect(input.getAttribute('aria-describedby')).toBe(err.id);
  });
});

describe('NumberField', () => {
  it('понимает запятую и пробелы, отдаёт число', () => {
    const onChange = vi.fn();
    render(<NumberField label="Цена" value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Цена'), { target: { value: '1 234,5' } });
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
  });

  it('нечисловой ввод остаётся в поле с ошибкой «Введите число», форма получает NaN (а не прежнее число)', () => {
    const onChange = vi.fn();
    render(<NumberField label="Кол-во" value={10} onChange={onChange} />);
    const input = screen.getByLabelText('Кол-во') as HTMLInputElement;
    expect(input.value).toBe('10');
    fireEvent.change(input, { target: { value: '12шт' } });
    expect(input.value).toBe('12шт');
    expect(screen.getByText('Введите число')).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Number.isNaN(onChange.mock.calls[0][0])).toBe(true);
  });

  it('форма с NaN в состоянии не теряет введённый текст; «1о00» не превращается в 1', () => {
    const seen: (number | undefined)[] = [];
    function Form() {
      const [v, setV] = useState<number | undefined>(1);
      seen.push(v);
      return <NumberField label="Кол-во" value={v} onChange={setV} />;
    }
    render(<Form />);
    const input = screen.getByLabelText('Кол-во') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1о00' } });
    expect(input.value).toBe('1о00');
    expect(Number.isNaN(seen[seen.length - 1])).toBe(true);
    expect(screen.getByText('Введите число')).toBeTruthy();
    fireEvent.change(input, { target: { value: '100' } });
    expect(seen[seen.length - 1]).toBe(100);
    expect(screen.queryByText('Введите число')).toBeNull();
  });

  it('пустое поле → undefined', () => {
    const onChange = vi.fn();
    render(<NumberField label="CBM" value={1.5} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('CBM'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('SelectField / DateField / CheckboxField', () => {
  it('выбор из списка отдаёт значение; пустой вариант → undefined', () => {
    const onChange = vi.fn();
    render(<SelectField label="Валюта" value="CNY" placeholder="— не выбрано —" options={[{ value: 'CNY', label: 'юань (RMB)' }, { value: 'USD', label: 'доллар' }]} onChange={onChange} />);
    const select = screen.getByLabelText('Валюта') as HTMLSelectElement;
    expect(select.value).toBe('CNY');
    fireEvent.change(select, { target: { value: 'USD' } });
    expect(onChange).toHaveBeenLastCalledWith('USD');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('дата — ISO YYYY-MM-DD, очистка → undefined', () => {
    const onChange = vi.fn();
    render(<DateField label="Дата заказа" value="2026-10-25" onChange={onChange} />);
    const input = screen.getByLabelText('Дата заказа') as HTMLInputElement;
    expect(input.value).toBe('2026-10-25');
    fireEvent.change(input, { target: { value: '2026-11-01' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('флажок', () => {
    const onChange = vi.fn();
    render(<CheckboxField label="Закупка" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Закупка'));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});

describe('DataTable', () => {
  const rows = [{ id: 'a', name: 'Кран', qty: 5 }, { id: 'b', name: 'Задвижка', qty: 7 }];
  const columns = [
    { key: 'name', header: 'Название', render: (r: typeof rows[number]) => r.name },
    { key: 'qty', header: 'Кол-во', align: 'right' as const, render: (r: typeof rows[number]) => r.qty },
  ];

  it('строки внутри блока с горизонтальной прокруткой; клик по строке', () => {
    const onRowClick = vi.fn();
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const table = screen.getByRole('table');
    expect(table.parentElement?.classList.contains('table-scroll')).toBe(true);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Название', 'Кол-во']);
    fireEvent.click(screen.getByText('Задвижка'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('пустые данные — текст вместо таблицы', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty="Пока пусто" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Пока пусто')).toBeTruthy();
  });
});

describe('ErrorBanner', () => {
  it('по умолчанию «Нет связи с таблицей — повторить», кнопка вызывает onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Нет связи с таблицей');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('текст из StoreError по виду ошибки', () => {
    render(<ErrorBanner error={new StoreError('notFound')} />);
    expect(screen.getByRole('alert').textContent).toContain('Запись не найдена');
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });
});

describe('EmptyState', () => {
  it('заголовок, текст и действия — кнопки и ссылки', () => {
    const onCreate = vi.fn();
    render(
      <MemoryRouter>
        <EmptyState title="Заказов пока нет" text="Создайте первый" actions={[{ label: 'Создать заказ', onClick: onCreate }, { label: 'Импорт из старой таблицы', to: '/import' }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Заказов пока нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать заказ' }));
    expect(onCreate).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Импорт из старой таблицы' }).getAttribute('href')).toBe('/import');
  });
});
