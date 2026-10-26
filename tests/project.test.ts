// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import codeGs from '../apps-script/Code.gs?raw';
import manifestJson from '../apps-script/appsscript.json?raw';

const root = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('проект', () => {
  it('исходники скрипта таблицы импортируются как ?raw', () => {
    expect(codeGs).toContain('function onOpen');
    expect(JSON.parse(manifestJson).timeZone).toBe('Europe/Moscow');
  });

  it('R34: в коде приложения нет обращений к ИИ, LLM и сервисам машинного перевода', () => {
    const forbidden = /openai|anthropic|gemini|generativelanguage|translate\.googleapis|translation\.googleapis|deepl|yandex\.net\/translate|huggingface|ollama|mistral|cohere/i;
    const offenders = files(join(root, 'src')).filter((f) => forbidden.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('.env.example перечисляет переменные конфигурации без значений', () => {
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    for (const name of ['VITE_GOOGLE_CLIENT_ID', 'VITE_GOOGLE_API_KEY', 'VITE_GOOGLE_APP_ID', 'VITE_BASE_PATH']) {
      expect(env).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^fixtures\/private\/$/m);
  });

  it('общие классы карточек, тулбаров и .btn--danger объявлены только в styles.css', () => {
    const shared = /^\s*\.(ui-card|ui-toolbar|btn--danger|btn--link|confirm-delete|order-card|ship-section|dir-card|orders-toolbar|ship-toolbar|dir-toolbar)(__[\w-]+|--[\w-]+)?\s*\{/m;
    const offenders = files(join(root, 'src')).filter((f) => f.endsWith('.css') && !f.endsWith(join('ui', 'styles.css')) && shared.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    const styles = readFileSync(join(root, 'src', 'ui', 'styles.css'), 'utf8');
    for (const cls of ['.ui-card {', '.ui-toolbar {', '.btn--danger {']) expect(styles).toContain(cls);
  });
});
