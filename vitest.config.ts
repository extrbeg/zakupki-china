import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}', 'apps-script/test/**/*.test.{js,ts}'],
    setupFiles: ['tests/setup.ts'],
  },
});
