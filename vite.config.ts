import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// Номер версии — из package.json, в приложение попадает как import.meta.env.VITE_APP_VERSION.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// base для GitHub Pages задаётся переменной VITE_BASE_PATH (например, /zakupki/); по умолчанию — корень.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = normalizeBase(env.VITE_BASE_PATH);
  return {
    base,
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
    plugins: [
      react(),
      VitePWA({
        // prompt: новая версия не подменяет открытую молча — приложение показывает «Доступна новая версия — Обновить».
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Закупки Китай',
          short_name: 'Закупки',
          description: 'Учёт закупок в Китае, курсы и себестоимость позиций',
          lang: 'ru',
          display: 'standalone',
          start_url: '.',
          scope: '.',
          theme_color: '#1f4e79',
          background_color: '#ffffff',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // R32: кэшируется только оболочка приложения; данные таблицы и запросы к Google не кэшируются.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: 'index.html',
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});

function normalizeBase(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '/';
  const withLead = v.startsWith('/') ? v : `/${v}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}
