// «Вставить из Excel» (G07): текст из буфера → предпросмотр со статусом каждой строки → «Добавить N позиций» (только корректные).
// Разбор — чистая функция parsePastedLines.

import { useMemo, useState } from 'react';
import { F, SHORT } from '../../../domain/labels';
import { newId } from '../../../domain/ids';
import type { Line, Order, SupplierOrder } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ErrorBanner, TextField } from '../../components';
import { formatNumber, formatQty } from '../../format';
import { positionsWord } from './linesLogic';
import { parsePastedLines } from './pasteLines';

export function PastePanel({ order, so, nextSeq, initialText, onClose }: {
  order: Order; so: SupplierOrder; nextSeq: number; initialText: string; onClose: () => void;
}) {
  const data = useData();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [added, setAdded] = useState(0);
  const rows = useMemo(() => parsePastedLines(text), [text]);
  const good = rows.filter((r) => r.ok && r.line);

  const add = async () => {
    setBusy(true);
    setSaveError(undefined);
    let done = 0;
    try {
      let seq = nextSeq;
      for (const r of good) {
        const line: Line = { id: newId('ln'), orderId: order.id, supplierOrderId: so.id, seq: seq++, ...r.line!, purchased: false };
        await data.save('lines', line);
        done++;
      }
      onClose();
    } catch (e) {
      // Часть строк могла записаться: убираем их из текста, чтобы повтор не задвоил позиции.
      const savedRows = new Set(good.slice(0, done).map((r) => r.rowNo));
      setText(text.split(/\r\n|\r|\n/).filter((_, i) => !savedRows.has(i + 1)).join('\n'));
      setAdded((a) => a + done);
      setSaveError(e);
      setBusy(false);
    }
  };

  return (
    <section className="paste-panel" aria-label="Вставка из Excel">
      <h3 className="paste-panel__title">Вставить из Excel</h3>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      {added > 0 ? <p className="small">Уже добавлено: {added}. Оставшиеся строки — ниже.</p> : null}
      <TextField
        label="Строки из Excel" multiline value={text} onChange={setText}
        hint="Скопируйте ячейки в Excel и вставьте сюда. Колонки по порядку: товар, кол-во, цена, затем необязательные HS-код, CBM, вес."
      />
      {rows.length > 0 ? (
        <div className="table-scroll paste-panel__preview">
          <table className="table" aria-label="Предпросмотр вставки">
            <thead>
              <tr>
                <th scope="col">Строка</th><th scope="col">Товар</th><th scope="col" className="num">Кол-во</th><th scope="col" className="num">{SHORT.unitPrice}</th>
                <th scope="col">HS-код</th><th scope="col" className="num">CBM</th><th scope="col" className="num">{F.weight}</th><th scope="col">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNo} className={r.ok ? undefined : r.header ? 'paste-row--skip' : 'paste-row--bad'}>
                  <td>{r.rowNo}</td>
                  <td className="cell--name">{r.line ? r.line.customerName : r.cells[0]}</td>
                  <td className="num">{r.line ? formatQty(r.line.qty) : r.cells[1] ?? ''}</td>
                  <td className="num">{r.line ? formatNumber(r.line.unitPrice) : r.cells[2] ?? ''}</td>
                  <td>{r.line ? r.line.hsCode ?? '' : r.cells[3] ?? ''}</td>
                  <td className="num">{r.line ? (r.line.cbm !== undefined ? formatNumber(r.line.cbm, 3) : '') : r.cells[4] ?? ''}</td>
                  <td className="num">{r.line ? (r.line.weight !== undefined ? formatNumber(r.line.weight) : '') : r.cells[5] ?? ''}</td>
                  <td className="paste-row__status">{r.ok ? 'ок' : r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="ui-card__actions">
        <button type="button" className="btn btn--primary" disabled={busy || good.length === 0} onClick={() => void add()}>
          {`Добавить ${good.length} ${positionsWord(good.length)}`}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Отмена</button>
      </div>
    </section>
  );
}
