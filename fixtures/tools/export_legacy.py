"""Выгрузка значений старой таблицы «Закупки Китай AREC» из xlsx в формат LegacyRaw (src/import).

Результат — как его отдал бы Sheets API batchGet с UNFORMATTED_VALUE + SERIAL_NUMBER:
числа — числами, флажки — true/false, даты — serial-числами Google Sheets (эпоха 1899-12-30),
ошибки формул — строкой (#DIV/0!), пустые ячейки внутри строки — '', пустой хвост строк и листа обрезан.
Берутся кэшированные значения формул (data_only=True). Скрытые листы не выгружаются.

Запуск (openpyxl из venv, изолированно):
    <venv>/bin/python -I fixtures/tools/export_legacy.py <book.xlsx> fixtures/private/legacy.json

Результат содержит коммерческие данные — только в fixtures/private/ (вне git).
"""

import datetime as dt
import json
import sys

import openpyxl

SHEETS = ['Заказы', 'Затраты по заказам', 'Списки', 'Поставщики исходник', 'Платежные агенты', 'Перевозчики']
EPOCH = dt.datetime(1899, 12, 30)


def cell_value(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return v
    if isinstance(v, dt.datetime):
        return (v - EPOCH).total_seconds() / 86400
    if isinstance(v, dt.date):
        return float((dt.datetime(v.year, v.month, v.day) - EPOCH).days)
    if isinstance(v, dt.time):
        return (v.hour * 3600 + v.minute * 60 + v.second) / 86400
    if isinstance(v, (int, float)):
        return v
    return str(v)


def sheet_values(ws):
    rows = []
    for row in ws.iter_rows(values_only=True):
        vals = [cell_value(v) for v in row]
        while vals and vals[-1] == '':
            vals.pop()
        rows.append(vals)
    while rows and not rows[-1]:
        rows.pop()
    return rows


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    out = {'sheets': {}}
    for ws in wb.worksheets:
        if ws.title not in SHEETS or ws.sheet_state != 'visible':
            continue
        out['sheets'][ws.title] = {'hidden': False, 'values': sheet_values(ws)}
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print({name: len(s['values']) for name, s in out['sheets'].items()})


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('использование: export_legacy.py <book.xlsx> <legacy.json>')
    main(sys.argv[1], sys.argv[2])
