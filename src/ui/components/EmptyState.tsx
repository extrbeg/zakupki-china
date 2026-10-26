import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type EmptyAction = { label: string; onClick: () => void; to?: never } | { label: string; to: string; onClick?: never };

export interface EmptyStateProps {
  title: string;
  text?: ReactNode;
  actions?: EmptyAction[];
}

export function EmptyState({ title, text, actions = [] }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2 className="empty-state__title">{title}</h2>
      {text ? <p className="empty-state__text">{text}</p> : null}
      {actions.length > 0 ? (
        <div className="empty-state__actions">
          {actions.map((a, i) =>
            a.to !== undefined ? (
              <Link key={a.label} className={`btn${i === 0 ? ' btn--primary' : ''}`} to={a.to}>{a.label}</Link>
            ) : (
              <button key={a.label} type="button" className={`btn${i === 0 ? ' btn--primary' : ''}`} onClick={a.onClick}>{a.label}</button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
