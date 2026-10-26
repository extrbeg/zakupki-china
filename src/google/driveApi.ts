// Drive API v3: список таблиц, доступных приложению (G19, история 88).
// С областью drive.file (ADR 0002) files.list отдаёт только файлы, которые приложение создало или пользователь выбрал
// в окне Google, — с любого устройства под тем же аккаунтом. Так телефон видит таблицу, созданную на компьютере,
// без окна выбора Google. Область доступа не расширяется.

import { getAccessToken } from './auth';
import { googleRequest, type RequestOptions, type TokenGetter } from './http';

export interface AppSpreadsheet {
  id: string;
  name: string;
  /** ISO 8601, UTC. */
  modifiedTime: string;
}

export interface DriveApiDeps { getToken?: TokenGetter; request?: RequestOptions }

const FILES = 'https://www.googleapis.com/drive/v3/files';
const SPREADSHEET_QUERY = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";

/** Таблицы, доступные приложению, свежие сверху. Ошибки — GoogleApiError/AuthError из общей обёртки. */
export async function listAppSpreadsheets(deps: DriveApiDeps = {}): Promise<AppSpreadsheet[]> {
  const params = new URLSearchParams({
    q: SPREADSHEET_QUERY,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
  });
  const res = await googleRequest<{ files?: { id?: string; name?: string; modifiedTime?: string }[] }>(
    deps.getToken ?? getAccessToken, 'GET', `${FILES}?${params.toString()}`, undefined, deps.request,
  );
  return (res?.files ?? [])
    .filter((f) => f.id)
    .map((f) => ({ id: f.id!, name: f.name ?? '', modifiedTime: f.modifiedTime ?? '' }));
}
