import { theme } from '@ext/lib/state';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { App } from './App';
import { initAnalytics, markReloading } from './analytics';
import { isLanding, STILL_FRAME } from './signals';
import './style.css';

// A deploy deletes the last build's chunks, so a tab opened before it fails its next lazy
// import. Reload into the new build, at most once a minute so a chunk that is genuinely
// unreachable (offline, blocked) still surfaces as an error instead of a reload loop.
const RELOADED_AT = 'marklayer:chunk-reload';
window.addEventListener('vite:preloadError', () => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT)) < 60_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return;
  }
  markReloading();
  location.reload();
});

effect(() => {
  const t = theme.value;
  const cls = document.documentElement.classList;
  cls.remove('light', 'dark');
  t !== 'system' && cls.add(t);
});

// Before render, so events from the first mount are counted rather than dropped.
// `.env.local` holds the production key, so `bun dev` would otherwise fill PostHog
// with our own localhost sessions and replays. Nothing here is a real user.
initAnalytics({
  key: import.meta.env.DEV ? undefined : import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
  host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  surface: isLanding.peek() ? 'landing' : STILL_FRAME ? 'demo' : 'viewer',
});

const root = document.getElementById('app')!;
root.innerHTML = '';
render(<App />, root);
