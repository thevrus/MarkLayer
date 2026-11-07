import { signal } from '@preact/signals';

// Reading the handle is itself the risky part: in a sandboxed iframe, or with
// site data blocked, touching `localStorage` throws rather than returning null,
// and this module is imported by a content script running on any page. Exported
// so the web app's modules reach for this rather than a private copy.
function openLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let handle: Storage | null | undefined;
let persist = true;
const ls = () => {
  if (!persist) return null;
  if (handle === undefined) handle = openLocalStorage();
  return handle;
};

export function lsGet(key: string): string | null {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string | null) {
  try {
    value === null ? ls()?.removeItem(key) : ls()?.setItem(key, value);
  } catch {
    /* */
  }
}

const hydrators: (() => void)[] = [];
let hydrated = false;

/** Reads stored state once the host has said it may: at `initHost`, or now for a module loaded after it. */
export function onHydrate(read: () => void) {
  hydrators.push(read);
  if (hydrated) read();
}

/** Called by `initHost`. Nothing touches storage before it, and with `persist` false nothing does after. */
export function hydrateStorage({ persist: allowed }: { persist: boolean }) {
  persist = allowed;
  hydrated = true;
  for (const read of hydrators) read();
}

/**
 * A boolean setting that survives a reload, as a signal plus its toggle.
 *
 * Only the non-default value is ever written, so a missing key means "as
 * shipped" — which is what lets a default flip in code carry over to everyone
 * who never touched the setting.
 */
export function persistedFlag({ key, fallback }: { key: string; fallback: boolean }) {
  const flag = signal(fallback);
  onHydrate(() => {
    const stored = lsGet(key);
    if (stored !== null) flag.value = stored === '1';
  });
  const toggle = () => {
    flag.value = !flag.value;
    lsSet(key, flag.value === fallback ? null : flag.value ? '1' : '0');
  };
  return [flag, toggle] as const;
}
