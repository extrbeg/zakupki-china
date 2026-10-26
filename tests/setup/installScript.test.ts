import { describe, expect, it, vi } from 'vitest';
import { installScript } from '../../src/setup/installScript';
import { ensureSchema } from '../../src/setup/ensureSchema';
import { ScriptApiDisabledError } from '../../src/google/errors';
import { GoogleApiError } from '../../src/google/errors';
import { SheetsStore } from '../../src/store/sheetsStore';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const SP = 'sp_script';

async function prepared() {
  const fake = new FakeSheetsApi();
  fake.seed(SP, {});
  await ensureSchema(fake, SP);
  return fake;
}

function scriptDeps() {
  return {
    createBoundScript: vi.fn(async (_sp: string, _title: string) => ({ scriptId: 'scr_new' })),
    updateScriptContent: vi.fn(async (_id: string, _files: { name: string; type: string; source: string }[]) => {}),
  };
}

describe('installScript', () => {
  it('нет meta.scriptId → создаётся скрипт таблицы, scriptId пишется в «_meta», код загружается', async () => {
    const fake = await prepared();
    const deps = scriptDeps();
    const res = await installScript(fake, SP, deps);
    expect(res).toEqual({ ok: true, scriptId: 'scr_new' });
    expect(deps.createBoundScript).toHaveBeenCalledWith(SP, expect.any(String));
    const files = deps.updateScriptContent.mock.calls[0][1];
    expect(deps.updateScriptContent.mock.calls[0][0]).toBe('scr_new');
    const code = files.find((f) => f.name === 'Code');
    const manifest = files.find((f) => f.name === 'appsscript');
    expect(code?.type).toBe('SERVER_JS');
    expect(code?.source).toContain('function onOpen');
    expect(manifest?.type).toBe('JSON');
    expect(JSON.parse(manifest!.source).timeZone).toBe('Europe/Moscow');
    const meta = (await new SheetsStore(fake, SP).load()).meta;
    expect(meta.scriptId).toBe('scr_new');
  });

  it('есть meta.scriptId → только обновление содержимого', async () => {
    const fake = await prepared();
    const deps = scriptDeps();
    await installScript(fake, SP, deps);
    const again = scriptDeps();
    const res = await installScript(fake, SP, again);
    expect(res).toEqual({ ok: true, scriptId: 'scr_new' });
    expect(again.createBoundScript).not.toHaveBeenCalled();
    expect(again.updateScriptContent).toHaveBeenCalledWith('scr_new', expect.any(Array));
    const metaRows = fake.values(SP, '_meta').filter((r) => r[0] === 'scriptId');
    expect(metaRows).toHaveLength(1);
  });

  it('скрипт удалён пользователем (404 на update) → создаётся заново', async () => {
    const fake = await prepared();
    await installScript(fake, SP, scriptDeps());
    const deps = scriptDeps();
    deps.createBoundScript.mockResolvedValueOnce({ scriptId: 'scr_2' });
    deps.updateScriptContent.mockRejectedValueOnce(new GoogleApiError(404));
    expect(await installScript(fake, SP, deps)).toEqual({ ok: true, scriptId: 'scr_2' });
    expect((await new SheetsStore(fake, SP).load()).meta.scriptId).toBe('scr_2');
  });

  it('Apps Script API выключен → API_DISABLED', async () => {
    const fake = await prepared();
    const deps = scriptDeps();
    deps.createBoundScript.mockRejectedValueOnce(new ScriptApiDisabledError());
    const res = await installScript(fake, SP, deps);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('API_DISABLED');
  });

  it('прочий сбой → FAILED с сообщением', async () => {
    const fake = await prepared();
    const deps = scriptDeps();
    deps.createBoundScript.mockRejectedValueOnce(new GoogleApiError(500, 'Internal error'));
    const res = await installScript(fake, SP, deps);
    expect(res).toMatchObject({ ok: false, reason: 'FAILED' });
    expect(res.ok === false && res.message.length).toBeGreaterThan(0);
  });
});
