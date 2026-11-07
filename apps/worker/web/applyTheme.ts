import { theme } from '@ext/lib/prefs';
import { effect } from '@preact/signals';

/** Puts the saved theme on `<html>`; `system` leaves it to the stylesheet's media query. */
export function applyTheme(): void {
  effect(() => {
    const t = theme.value;
    const cls = document.documentElement.classList;
    cls.remove('light', 'dark');
    t !== 'system' && cls.add(t);
  });
}
