import { LocalStore } from '../store/localStore';
import { demoSeed } from './seed';

export { demoSeed } from './seed';

/** Ключ localStorage с данными демо-режима. */
export const DEMO_STORAGE_KEY = 'zk:demo';

/** Хранилище демо-режима: данные только в этом браузере, при первом открытии — синтетический набор. */
export function createDemoStore(): LocalStore {
  return new LocalStore(DEMO_STORAGE_KEY, demoSeed());
}
