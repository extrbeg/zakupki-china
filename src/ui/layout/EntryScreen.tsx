// Экран входа: подключение Google (если задан VITE_GOOGLE_CLIENT_ID) и демо-режим.

import ConnectScreen from '../screens/connect/ConnectScreen';
import { useSession } from '../DataContext';

export function EntryScreen() {
  const { googleConfigured, startDemo } = useSession();
  return (
    <main className="entry">
      <div className="entry__card">
        <img className="entry__logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={56} height={56} />
        <h1 className="entry__title">Закупки Китай</h1>
        <p className="muted">Учёт закупок, курсы и себестоимость позиций. Данные хранятся в вашей Google-таблице.</p>
        {googleConfigured ? (
          <div className="entry__google" data-testid="google-connect">
            <ConnectScreen />
          </div>
        ) : null}
        <div className="entry__demo">
          <button type="button" className={`btn${googleConfigured ? '' : ' btn--primary'}`} onClick={startDemo}>
            Попробовать без Google
          </button>
          <p className="muted small">Демо-режим: данные хранятся только в этом браузере.</p>
        </div>
      </div>
    </main>
  );
}
