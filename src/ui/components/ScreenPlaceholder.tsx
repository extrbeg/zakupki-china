// Заглушка экрана: заголовок и пометка, что раздел появится позже. Таски экранов заменяют свой файл целиком.

export function ScreenPlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <section className="screen">
      <h1 className="screen__title">{title}</h1>
      <p className="muted">{note ?? 'Раздел в разработке.'}</p>
    </section>
  );
}
