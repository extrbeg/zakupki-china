// Экран «Поставка» (маршрут /shipments/:id; `new` — создание): шапка, предупреждения, партии, декларации, затраты.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../../DataContext';
import { BatchesSection } from './BatchesSection';
import { DeclarationsSection } from './DeclarationsSection';
import { ShipmentCosts } from './ShipmentCosts';
import { ShipmentForm } from './ShipmentForm';
import { ShipmentWarnings } from './ShipmentWarnings';
import './shipments.css';

export default function ShipmentScreen() {
  const { id } = useParams();
  const { ds, status } = useData();
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const back = <p><Link to="/shipments">← Все поставки</Link></p>;

  // Ошибку загрузки показывает оболочка (Layout) — здесь второго баннера нет.
  if (status === 'loading') return <section className="screen">{back}<p className="ship-muted">Загрузка…</p></section>;

  if (id === 'new') {
    return (
      <section className="screen">
        {back}
        <h1 className="screen__title">Новая поставка</h1>
        <ShipmentForm />
      </section>
    );
  }

  const shipment = ds.shipments.find((s) => s.id === id);
  if (!shipment) {
    return (
      <section className="screen">
        {back}
        <h1 className="screen__title">Поставка не найдена</h1>
      </section>
    );
  }

  const pickBatch = (batchId: string) => {
    setHighlight(batchId);
    document.getElementById(`batch-${batchId}`)?.scrollIntoView?.({ block: 'center' });
  };

  return (
    <section className="screen">
      {back}
      <h1 className="screen__title">Поставка</h1>
      <ShipmentForm key={shipment.id} shipment={shipment} />
      <ShipmentWarnings shipmentId={shipment.id} onPickBatch={pickBatch} />
      <BatchesSection shipment={shipment} highlightId={highlight} />
      <DeclarationsSection shipment={shipment} />
      <ShipmentCosts shipment={shipment} />
    </section>
  );
}
