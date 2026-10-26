// Google Picker: пользователь выбирает существующую таблицу. С областью drive.file выбор в Picker
// и даёт приложению доступ к этому файлу — поэтому нужен VITE_GOOGLE_APP_ID (номер проекта Google Cloud).
// По ссылке (fileId) окно открывается сразу с этим файлом (DocsView.setFileIds): доступ появляется только после «Выбрать»,
// область доступа та же — drive.file (ADR 0002).
// На телефоне и в установленной PWA окно может закрыться, не вернув ответа (G19, история 88): если приложение снова получило
// фокус, а ответа нет PICKER_STALL_MS, зовётся onStall — экран снимает ожидание; поздний ответ всё равно принимается.

import { getAccessToken } from './auth';
import { AuthError } from './errors';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setCallback(cb: (data: PickerResult) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface PickerResult { action: string; docs?: { id: string; name: string }[] }
interface PickerNs {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => { setMimeTypes?(m: string): unknown; setMode?(m: unknown): unknown; setFileIds?(ids: string): unknown };
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string; CANCEL: string };
}
type Win = { gapi?: { load(name: string, cb: () => void): void }; google?: { picker?: PickerNs } };

let loading: Promise<PickerNs> | null = null;

function loadPicker(): Promise<PickerNs> {
  const w = window as unknown as Win;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  if (!loading) {
    loading = new Promise<PickerNs>((resolve, reject) => {
      const withGapi = () => w.gapi!.load('picker', () => {
        const p = (window as unknown as Win).google?.picker;
        if (p) resolve(p); else reject(new Error('Не удалось загрузить выбор файла Google'));
      });
      if (w.gapi) { withGapi(); return; }
      const s = document.createElement('script');
      s.src = GAPI_SRC;
      s.async = true;
      s.onload = withGapi;
      s.onerror = () => reject(new Error('Не удалось загрузить выбор файла Google — проверьте связь'));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** Сколько ждать ответа окна после возврата фокуса в приложение, мс. */
export const PICKER_STALL_MS = 4000;

export interface PickOptions {
  /** id файла из ссылки: окно показывает только этот файл. */
  fileId?: string;
  /** Окно закрылось без ответа: фокус вернулся в приложение, ответа нет PICKER_STALL_MS. Промис остаётся живым. */
  onStall?: () => void;
}

/** Следить за возвратом фокуса в приложение, пока окно открыто; возвращает функцию остановки. */
function watchReturn(onStall: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (timer !== null) return;
    timer = setTimeout(() => { stop(); onStall(); }, PICKER_STALL_MS);
  };
  const onVisible = () => { if (document.visibilityState !== 'hidden') arm(); };
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener('focus', arm);
    document.removeEventListener('visibilitychange', onVisible);
  };
  window.addEventListener('focus', arm);
  document.addEventListener('visibilitychange', onVisible);
  return stop;
}

/** Открыть Picker с таблицами пользователя (или с одним файлом по fileId). Отмена — null. */
export async function pickSpreadsheet(options: PickOptions = {}): Promise<{ id: string; name: string } | null> {
  const token = await getAccessToken();
  if (!token) throw new AuthError();
  const picker = await loadPicker();
  return new Promise((done) => {
    let stopWatch = () => {};
    const resolve = (v: { id: string; name: string } | null) => { stopWatch(); done(v); };
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    view.setMimeTypes?.('application/vnd.google-apps.spreadsheet');
    if (options.fileId) view.setFileIds?.(options.fileId);
    let builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setLocale('ru')
      .setTitle(options.fileId ? 'Подтвердите таблицу — нажмите «Выбрать»' : 'Выберите таблицу «Закупки»')
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const appId = import.meta.env.VITE_GOOGLE_APP_ID;
    if (apiKey) builder = builder.setDeveloperKey(apiKey);
    if (appId) builder = builder.setAppId(appId);
    builder.build().setVisible(true);
    if (options.onStall) stopWatch = watchReturn(options.onStall);
  });
}
