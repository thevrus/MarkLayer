import { createStore, del, get, set } from 'idb-keyval';
import type { DrawOp } from './types';

export interface DraftStore {
  restore: () => Promise<void>;
  scheduleSave: () => void;
  /** Fire-and-forget. */
  clear: () => void;
}

export interface DraftStoreOptions {
  /** A function when the key follows the page, so an SPA route saves under its own URL. */
  key: string | (() => string);
  getOps: () => DrawOp[];
  setOps: (ops: DrawOp[]) => void;
  notify?: (message: string) => void;
  debounceMs?: number;
}

export function createDraftStore(opts: DraftStoreOptions): DraftStore {
  const store = createStore('marklayer-drafts', 'drafts');
  const { key, getOps, setOps, notify, debounceMs = 500 } = opts;
  const keyNow = () => (typeof key === 'function' ? key() : key);
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    restore: async () => {
      try {
        const saved = await get<DrawOp[]>(keyNow(), store);
        if (saved?.length && !getOps().length) {
          setOps(saved);
          notify?.('Draft restored');
        }
      } catch {
        // IndexedDB unavailable — silently continue
      }
    },
    scheduleSave: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        set(keyNow(), getOps(), store).catch(() => {});
      }, debounceMs);
    },
    clear: () => {
      del(keyNow(), store).catch(() => {});
    },
  };
}
