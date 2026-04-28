import { createStore, del, get, set } from 'idb-keyval';
import type { DrawOp } from './types';

export interface DraftStore {
  /** Restore the draft if any, applying it via the configured setOps callback. */
  restore: () => Promise<void>;
  /** Schedule a debounced save of the current ops. */
  scheduleSave: () => void;
  /** Clear the saved draft (fire-and-forget). */
  clear: () => void;
}

export interface DraftStoreOptions {
  key: string;
  getOps: () => DrawOp[];
  setOps: (ops: DrawOp[]) => void;
  /** Optional notification on successful restore. */
  notify?: (message: string) => void;
  /** Debounce window for saves, defaults to 500ms. */
  debounceMs?: number;
}

export function createDraftStore(opts: DraftStoreOptions): DraftStore {
  const store = createStore('marklayer-drafts', 'drafts');
  const { key, getOps, setOps, notify, debounceMs = 500 } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    restore: async () => {
      try {
        const saved = await get<DrawOp[]>(key, store);
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
        set(key, getOps(), store).catch(() => {});
      }, debounceMs);
    },
    clear: () => {
      del(key, store).catch(() => {});
    },
  };
}
