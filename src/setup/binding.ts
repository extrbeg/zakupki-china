// Привязка «аккаунт Google → таблица» на этом устройстве: localStorage `zk:binding:<email>`.

const key = (email: string) => `zk:binding:${email.trim().toLowerCase()}`;

export function getBinding(email: string): string | null {
  try {
    return localStorage.getItem(key(email)) || null;
  } catch {
    return null;
  }
}

export function setBinding(email: string, spreadsheetId: string | null): void {
  try {
    if (spreadsheetId) localStorage.setItem(key(email), spreadsheetId);
    else localStorage.removeItem(key(email));
  } catch { /* без localStorage привязка живёт до перезагрузки — придётся выбрать таблицу снова */ }
}
