import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base для GitHub Pages задаётся переменной VITE_BASE_PATH (например, /zakupki/); по умолчанию — корень.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = normalizeBase(env.VITE_BASE_PATH);
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
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
