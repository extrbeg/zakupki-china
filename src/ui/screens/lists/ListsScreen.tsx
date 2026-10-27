// Экран «Списки» (маршрут /lists): значения выпадающих списков редактируются отдельно от заказов.

import { LIST_DEFS } from '../../directories/listDefs';
import { ListEditor } from '../../directories/ListEditor';
import { ShipmentTypesEditor } from '../../directories/ShipmentTypesEditor';
import '../../directories/directories.css';

export default function ListsScreen() {
  return (
    <section className="screen">
      <h1 className="screen__title">Списки</h1>
      <p className="muted">
        Значения предлагаются в карточках заказов, поставщиков и затрат. Переименование не меняет уже записанные заказы.
      </p>
      {LIST_DEFS.map((d) => <ListEditor key={d.key} listKey={d.key} label={d.label} />)}
      <ShipmentTypesEditor />
    </section>
  );
}
