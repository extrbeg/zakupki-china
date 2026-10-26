// Связь между service worker (src/main.tsx) и плашкой «Доступна новая версия».
// Без service worker (dev, тесты) никто не вызывает announceUpdate — плашка просто не появляется.

type Apply = () => void | Promise<void>;

let pending: Apply | null = null;
const listeners = new Set<() => void>();

/** Найдена новая версия: apply обновляет приложение и перезагружает страницу. */
export function announceUpdate(apply: Apply): void {
  pending = apply;
  listeners.forEach((l) => l());
}

export function clearUpdate(): void {
  pending = null;
  listeners.forEach((l) => l());
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPendingUpdate(): Apply | null {
  return pending;
}
