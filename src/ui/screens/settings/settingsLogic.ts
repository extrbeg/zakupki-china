// Чистые функции экрана «Настройки».

/**
 * Адрес docs/setup.md в репозитории приложения, если оно открыто с GitHub Pages:
 * <логин>.github.io/<репозиторий>/ → github.com/<логин>/<репозиторий>; без подпути — репозиторий <логин>.github.io.
 * Другой адрес (локальный запуск) — репозиторий неизвестен, null.
 */
export function setupDocsUrl(loc: { hostname: string; pathname: string }): string | null {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return null;
  const owner = m[1].toLowerCase();
  const first = loc.pathname.split('/').filter(Boolean)[0];
  const repo = first && !/\.html?$/i.test(first) ? first : `${owner}.github.io`;
  return `https://github.com/${owner}/${repo}/blob/HEAD/docs/setup.md`;
}
