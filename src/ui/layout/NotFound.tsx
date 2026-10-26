import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="screen">
      <h1 className="screen__title">Страница не найдена</h1>
      <p><Link to="/">К списку заказов</Link></p>
    </section>
  );
}
