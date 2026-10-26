import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerSW } from 'virtual:pwa-register';
import { announceUpdate } from './ui/layout/updateBus';
import './ui/styles.css';

// Service worker: при найденной новой версии показываем плашку «Обновить»; без SW (dev) ничего не происходит.
try {
  const updateSW = registerSW({
    onNeedRefresh() {
      announceUpdate(() => updateSW(true));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => { void registration.update().catch(() => undefined); };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
} catch {
  /* приложение работает и без service worker */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
