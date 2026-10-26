// Где открыть docs/setup.md из раздела «Google-таблица» в демо (история 82).
import { describe, expect, it } from 'vitest';
import { setupDocsUrl } from '../../src/ui/screens/settings/settingsLogic';

describe('setupDocsUrl', () => {
  it('GitHub Pages проекта <логин>.github.io/<репозиторий>/ → docs/setup.md в этом репозитории', () => {
    expect(setupDocsUrl({ hostname: 'ivanov.github.io', pathname: '/china-purchasing/' }))
      .toBe('https://github.com/ivanov/china-purchasing/blob/HEAD/docs/setup.md');
    expect(setupDocsUrl({ hostname: 'Ivanov.GitHub.io', pathname: '/repo/index.html' }))
      .toBe('https://github.com/ivanov/repo/blob/HEAD/docs/setup.md');
  });

  it('сайт пользователя <логин>.github.io без подпути → репозиторий <логин>.github.io', () => {
    expect(setupDocsUrl({ hostname: 'ivanov.github.io', pathname: '/' }))
      .toBe('https://github.com/ivanov/ivanov.github.io/blob/HEAD/docs/setup.md');
  });

  it('локальный запуск и другие адреса — репозиторий неизвестен, ссылки нет', () => {
    expect(setupDocsUrl({ hostname: 'localhost', pathname: '/' })).toBeNull();
    expect(setupDocsUrl({ hostname: 'example.com', pathname: '/app/' })).toBeNull();
    expect(setupDocsUrl({ hostname: 'github.io.example.com', pathname: '/x/' })).toBeNull();
  });
});
