// Плашка после обновления: «Приложение обновлено до X — что нового». Показывается один раз на устройство:
// последняя увиденная версия лежит в localStorage. При самом первом запуске плашки нет — только запоминаем версию.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION, compareVersions, entriesSince, type ChangelogEntry } from '../../changelog';

export const SEEN_VERSION_KEY = 'zk:lastSeenVersion';

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_VERSION_KEY); } catch { return null; }
}

function writeSeen(version: string): void {
  try { localStorage.setItem(SEEN_VERSION_KEY, version); } catch { /* без хранилища плашка просто не показывается */ }
}

/** Что показать: пусто — плашки нет. */
function pendingEntries(): ChangelogEntry[] | null {
  const seen = readSeen();
  if (seen === null) {
    writeSeen(APP_VERSION);
    return null;
  }
  if (compareVersions(APP_VERSION, seen) <= 0) return null;
  return entriesSince(seen);
}

export function WhatsNewBanner() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(pendingEntries);
  const [open, setOpen] = useState(false);
  if (!entries) return null;
  const close = () => {
    writeSeen(APP_VERSION);
    setEntries(null);
  };
  return (
    <div className="banner banner--demo" role="status">
      <span>Приложение обновлено до {APP_VERSION} —</span>
      <button type="button" className="btn btn--link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <u>что нового</u>
      </button>
      <button type="button" className="btn btn--small" style={{ marginLeft: 'auto' }} onClick={close}>Закрыть</button>
      {open ? (
        <div style={{ flexBasis: '100%' }}>
          {entries.map((e) => (
            <div key={e.version}>
              <strong>Версия {e.version}</strong>
              <ul>
                {[...e.added, ...e.fixed].map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          ))}
          <Link to="/changelog">Вся история</Link>
        </div>
      ) : null}
    </div>
  );
}
