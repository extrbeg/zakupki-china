import type { ReactNode } from 'react';

/** Сетка полей формы: несколько колонок на широком экране, одна — на телефоне. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>;
}
