import { signal } from '@preact/signals';

// Reading the handle is itself the risky part: in a sandboxed iframe, or with
// site data blocked, touching `localStorage` throws rather than returning null,
// and this module is imported by a content script running on any page. Exported
// so the web app's modules reach for this rather than a seventh private copy.
const _ls = (() => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
})();

export function lsGet(key: string): string | null {
  try {
    return _ls?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string | null) {
  try {
    value === null ? _ls?.removeItem(key) : _ls?.setItem(key, value);
  } catch {
    /* */
  }
}

/**
 * A boolean setting that survives a reload, as a signal plus its toggle.
 *
 * Only the non-default value is ever written, so a missing key means "as
 * shipped" — which is what lets a default flip in code carry over to everyone
 * who never touched the setting.
 */
export function persistedFlag({ key, fallback }: { key: string; fallback: boolean }) {
  const stored = lsGet(key);
  const flag = signal(stored === null ? fallback : stored === '1');
  const toggle = () => {
    flag.value = !flag.value;
    lsSet(key, flag.value === fallback ? null : flag.value ? '1' : '0');
  };
  return [flag, toggle] as const;
}
