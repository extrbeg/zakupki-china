// Таблица: на узком экране прокручивается по горизонтали внутри своего блока, страница не ломается.

import type { ReactNode } from 'react';

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Ширина колонки (CSS), например '8rem'. */
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Что показать, если строк нет. */
  empty?: ReactNode;
  footer?: ReactNode;
  caption?: string;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, footer, caption, className }: DataTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <div className="table-empty">{empty}</div>;
  return (
    <div className={`table-scroll${className ? ` ${className}` : ''}`}>
      <table className="table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ textAlign: c.align, width: c.width }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={onRowClick ? 'table__row--clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
