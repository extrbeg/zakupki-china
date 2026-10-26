// Плашка «Доступна новая версия — Обновить»: показывается, когда service worker нашёл свежую сборку.

import { useState, useSyncExternalStore } from 'react';
import { getPendingUpdate, subscribeUpdate } from './updateBus';

export function UpdateBanner() {
  const apply = useSyncExternalStore(subscribeUpdate, getPendingUpdate, getPendingUpdate);
  const [busy, setBusy] = useState(false);
  if (!apply) return null;
  const run = async () => {
    setBusy(true);
    try {
      await apply();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="banner banner--demo" role="status">
      <span>Доступна новая версия</span>
      <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void run()}>
        Обновить
      </button>
    </div>
  );
}
