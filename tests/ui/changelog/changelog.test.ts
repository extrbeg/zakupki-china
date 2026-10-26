import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG, compareVersions, entriesSince } from '../../../src/changelog';

const root = join(__dirname, '..', '..', '..');

/** Разбор CHANGELOG.md: «## 0.6.0 — 26.10.2026», разделы «### Новое» / «### Исправлено», пункты «- …». */
function parseMarkdown(text: string) {
  const entries: { version: string; date: string; added: string[]; fixed: string[] }[] = [];
  let section: 'added' | 'fixed' | null = null;
  for (const line of text.split('\n')) {
    const h = /^## (\d+\.\d+\.\d+) — (\d{2})\.(\d{2})\.(\d{4})\s*$/.exec(line);
    if (h) {
      entries.push({ version: h[1], date: `${h[4]}-${h[3]}-${h[2]}`, added: [], fixed: [] });
      section = null;
    } else if (/^### Новое\s*$/.test(line)) section = 'added';
    else if (/^### Исправлено\s*$/.test(line)) section = 'fixed';
    else if (line.startsWith('- ') && section && entries.length) entries[entries.length - 1][section].push(line.slice(2).trim());
  }
  return entries;
}

describe('история версий', () => {
  it('CHANGELOG.md и src/changelog.ts совпадают: версии, даты, пункты', () => {
    const md = parseMarkdown(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
    expect(md).toEqual(CHANGELOG);
  });

  it('первая запись — версия из package.json, и сборка показывает её же', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(pkg.version).toBe('0.7.0');
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('версии идут от новой к старой, без повторов, у каждой есть пункты', () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i += 1) expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0);
    expect(versions).toEqual(['0.7.0', '0.6.1', '0.6.0', '0.5.0', '0.4.0', '0.3.0', '0.2.0', '0.1.0']);
    for (const e of CHANGELOG) expect(e.added.length + e.fixed.length).toBeGreaterThan(0);
  });

  it('compareVersions сравнивает числами, а не строками', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('entriesSince: только версии новее увиденной, от новой к старой', () => {
    expect(entriesSince('0.4.0', '0.6.0').map((e) => e.version)).toEqual(['0.6.0', '0.5.0']);
    expect(entriesSince('0.6.0', '0.6.0')).toEqual([]);
  });
});
