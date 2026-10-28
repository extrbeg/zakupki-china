// Строка быстрого ввода внизу таблицы товаров (G06): товар, кол-во с единицей (по умолчанию — как у прошлого товара поставщика), цена; Enter сохраняет позицию — по умолчанию не в работе
// (запрос цены; «В работу» отмечается во вкладке «Сравнение цен» или в форме) — и возвращает курсор в товар новой пустой строки. Неверный ввод — ошибка у поля, ничего не сохраняется, введённое остаётся.
// Вставка таблицы (с табуляцией или несколькими строками) в поле товара открывает «Вставить из Excel».
// Товар подсказывается из прошлых позиций (история 93): выбранный (или введённый точно так же) берёт из последней такой позиции
// HS-код, пошлину, упаковку, название у поставщика, вес и CBM на единицу × кол-во.

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { newId } from '../../../domain/ids';
import { lineFigures } from '../../../domain/lineFigures';
import { exactProductHint, productFill, type ProductHint } from '../../../domain/productHints';
import { searchKey } from '../../../domain/search';
import type { Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { validateLine } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { ErrorBanner, parseUserNumber } from '../../components';
import { formatCoef, formatMoney, unitOf } from '../../format';
import { listValues } from '../../directories/records';
import { ProductNameInput, fillNote, useProductHints } from './ProductNameInput';

type Key = 'name' | 'qty' | 'price';

export function QuickLineEntry({ order, so, nextSeq, rate, onPasteTable }: {
  order: Order; so: SupplierOrder; nextSeq: number; rate: RatePick | null; onPasteTable: (text: string) => void;
}) {
  const data = useData();
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<Record<Key, string>>({ name: '', qty: '', price: '' });
  /** Текущий текст полей — его читает завершение записи (замыкание видит только снимок на момент Enter). */
  const textRef = useRef(text);
  textRef.current = text;
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const units = listValues(data.ds, 'unit');
  const lastUnit = unitOf([...data.ds.lines].filter((l) => l.supplierOrderId === so.id).sort((a, b) => b.seq - a.seq)[0]);
  const [unitChoice, setUnitChoice] = useState<string | undefined>(undefined);
  const unit = unitChoice ?? lastUnit;
  const hints = useProductHints();
  /** Выбранная подсказка товара; действует, пока название не поменяли. */
  const [picked, setPicked] = useState<ProductHint | undefined>(undefined);
  const hintFor = (name: string) => (picked && searchKey(picked.name) === searchKey(name) ? picked : exactProductHint(hints, name));
  const hint = hintFor(text.name);

  const qty = parseUserNumber(text.qty);
  const price = parseUserNumber(text.price);
  const live = typeof qty === 'number' && typeof price === 'number'
    ? lineFigures({ qty, unitPrice: price } as Line, rate, so)
    : null;

  const submit = async () => {
    if (busy) return;
    const found: Partial<Record<Key, string>> = {};
    const name = text.name.trim();
    if (name === '') found.name = 'Введите товар';
    const v = validateLine({ qty: qty ?? undefined, unitPrice: price ?? undefined });
    if (qty === null) found.qty = 'Введите число';
    else if (v.qty) found.qty = v.qty;
    if (price === null) found.price = 'Введите число';
    else if (v.unitPrice) found.price = v.unitPrice;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const line: Line = {
        id: newId('ln'), orderId: order.id, supplierOrderId: so.id, seq: nextSeq,
        customerName: name, qty: qty as number, unit, unitPrice: price as number, purchased: false,
      };
      const from = hintFor(name);
      if (from) Object.assign(line, productFill(from, qty as number));
      const snapshot = text;
      await data.save('lines', line);
      // Пока шла запись, человек мог начать следующий товар: очищаем только поля, которые не менялись с Enter.
      const now = textRef.current;
      const keep = (k: Key) => (now[k] === snapshot[k] ? '' : now[k]);
      const next = { name: keep('name'), qty: keep('qty'), price: keep('price') };
      textRef.current = next;
      setText(next);
      // название сохранено и очищено — выбранная подсказка отслужила; следующая строка ищет данные заново (уже с этой позицией)
      if (next.name === '') setPicked(undefined);
      if (now.name === snapshot.name && now.qty === snapshot.qty && now.price === snapshot.price) nameRef.current?.focus();
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit(); }
  };

  const input = (key: Key, label: string, extra: { numeric?: boolean; placeholder: string }) => {
    const err = errors[key];
    const errId = `${id}-${key}-error`;
    if (key === 'name') {
      const note = fillNote(hint);
      return (
        <>
          <ProductNameInput
            inputRef={nameRef} hints={hints} className="input input--cell" aria-label={label} placeholder={extra.placeholder} value={text.name}
            aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
            onChange={(value) => setText((t) => ({ ...t, name: value }))}
            onPickHint={(h) => { setPicked(h); setText((t) => ({ ...t, name: h.name })); }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (/[\t\n]/.test(pasted.trim())) { e.preventDefault(); onPasteTable(pasted); }
            }}
          />
          {err ? <div className="field__error" id={errId}>{err}</div> : note ? <div className="suggest__fill">{note}</div> : null}
        </>
      );
    }
    return (
      <>
        <input
          className={`input input--cell${extra.numeric ? ' input--number' : ''}`} type="text" inputMode={extra.numeric ? 'decimal' : undefined}
          aria-label={label} placeholder={extra.placeholder} value={text[key]}
          aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
          onChange={(e) => { const value = e.target.value; setText((t) => ({ ...t, [key]: value })); }}
          onKeyDown={onKeyDown}
        />
        {err ? <div className="field__error" id={errId}>{err}</div> : null}
      </>
    );
  };

  return (
    <tr className="entry-row">
      <td className="cell--pick" />
      <td className="muted">{nextSeq}</td>
      <td className="cell--name">
        {input('name', 'Товар новой позиции', { placeholder: 'Новый товар' })}
        {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      </td>
      <td>
        <div className="entry-qty">
          {input('qty', 'Кол-во новой позиции', { numeric: true, placeholder: 'кол-во' })}
          <select className="input input--cell entry-qty__unit" aria-label="Ед. изм. новой позиции" value={unit} onChange={(e) => setUnitChoice(e.target.value)}>
            {(units.includes(unit) ? units : [unit, ...units]).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </td>
      <td>{input('price', 'Цена новой позиции', { numeric: true, placeholder: 'цена' })}</td>
      <td className="num muted">{live ? formatMoney(live.X) : ''}</td>
      <td className="num muted">{live ? formatMoney(live.Y) : ''}</td>
      <td className="num muted lines-col--minor">{live ? formatMoney(live.Z) : ''}</td>
      <td className="num muted">{formatCoef(so.coef)}</td>
      <td className="num muted">{live ? formatMoney(live.AB) : ''}</td>
      <td className="num muted lines-col--minor">{live && live.AB !== null && typeof qty === 'number' ? formatMoney(live.AB * qty) : ''}</td>
      <td />
      <td className="lines-col--minor" />
      <td colSpan={2} />
      <td className="cell--actions">
        <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void submit()}>Добавить</button>
      </td>
    </tr>
  );
}
