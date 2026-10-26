// Оболочка: шапка, меню (на узком экране сворачивается), плашки демо/офлайн, состояние загрузки.
// Ошибку загрузки показывает только оболочка — один баннер «Нет связи с таблицей — Повторить» на все экраны.
// После первой успешной загрузки повторный reload() не размонтирует экран: его состояние (например, отчёт импорта) сохраняется.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useData, useSession } from '../DataContext';
import { ErrorBanner } from '../components';
import { MENU } from './menu';
import { OfflineBanner } from './OfflineBanner';
import { UpdateBanner } from './UpdateBanner';
import { WhatsNewBanner } from './WhatsNewBanner';
import { APP_VERSION, CURRENT_ENTRY } from '../../changelog';
import { formatDate } from '../format';

export function Layout({ children }: { children: ReactNode }) {
  const { session, endSession } = useSession();
  const { status, error, reload, store } = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  // Хранилище, данные которого уже загружались: новое хранилище (другая таблица) снова ждёт первой загрузки.
  const loadedStore = useRef<typeof store | null>(null);
  if (status === 'ready') loadedStore.current = store;
  const showScreen = status === 'ready' || loadedStore.current === store;

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="app">
      <header className="app__header">
        <button
          type="button" className="app__burger" aria-label="Меню" aria-expanded={menuOpen} aria-controls="app-nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="app__title">Закупки Китай</span>
        {session.mode === 'sheets' ? <span className="app__user muted small">{session.email}</span> : null}
      </header>
      {session.mode === 'demo' ? (
        <div className="banner banner--demo">
          <span>Демо — данные только в этом браузере</span>
          <button type="button" className="btn btn--small" onClick={endSession}>Выйти из демо</button>
        </div>
      ) : null}
      <OfflineBanner />
      <UpdateBanner />
      <WhatsNewBanner />
      <div className="app__body">
        <nav id="app-nav" className={`app__nav${menuOpen ? ' app__nav--open' : ''}`} aria-label="Разделы">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'} className={({ isActive }) => `app__nav-link${isActive ? ' app__nav-link--active' : ''}`}>
              {m.label}
            </NavLink>
          ))}
          <NavLink to="/changelog" className="app__nav-link muted small" style={{ marginTop: 'auto' }}>
            Версия {APP_VERSION} · {formatDate(CURRENT_ENTRY.date)}
          </NavLink>
        </nav>
        <main className="app__main">
          {status === 'error' ? <ErrorBanner error={error} onRetry={() => void reload()} /> : null}
          {showScreen ? children : status === 'loading' ? <p className="muted" role="status">Загрузка…</p> : null}
        </main>
      </div>
    </div>
  );
}
