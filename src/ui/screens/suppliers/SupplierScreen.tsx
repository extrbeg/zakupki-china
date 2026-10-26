// Экран «Поставщик» (маршрут /suppliers/:id; id = new — новая карточка).

import { Link, useParams } from 'react-router-dom';
import { useData } from '../../DataContext';
import { EmptyState } from '../../components';
import { SupplierCard } from '../../directories/SupplierCard';

export default function SupplierScreen() {
  const { id } = useParams();
  const { ds, status } = useData();
  if (id === 'new') return <SupplierCard key="new" />;
  const supplier = ds.suppliers.find((s) => s.id === id);
  if (!supplier) {
    if (status === 'loading') return <p className="muted" role="status">Загрузка…</p>;
    return (
      <section className="screen">
        <EmptyState title="Поставщик не найден" text={<Link to="/suppliers">К списку поставщиков</Link>} />
      </section>
    );
  }
  return <SupplierCard key={supplier.id} supplier={supplier} />;
}
