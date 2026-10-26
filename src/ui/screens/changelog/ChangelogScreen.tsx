// Экран «Что нового» (маршрут /changelog): версии от новой к старой, у каждой дата и разделы «Новое» / «Исправлено».

import { CHANGELOG } from '../../../changelog';
import { formatDate } from '../../format';

export default function ChangelogScreen() {
  return (
    <section className="screen">
      <h1 className="screen__title">Что нового</h1>
      {CHANGELOG.map((e) => {
        const id = `changelog-${e.version}`;
        return (
          <section key={e.version} aria-labelledby={id}>
            <h2 id={id}>Версия {e.version} · {formatDate(e.date)}</h2>
            {e.added.length > 0 ? (
              <>
                <h3>Новое</h3>
                <ul>{e.added.map((t) => <li key={t}>{t}</li>)}</ul>
              </>
            ) : null}
            {e.fixed.length > 0 ? (
              <>
                <h3>Исправлено</h3>
                <ul>{e.fixed.map((t) => <li key={t}>{t}</li>)}</ul>
              </>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
