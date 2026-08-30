import { theme } from '@ext/lib/state';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { App } from './App';
import { initAnalytics } from './analytics';
import { isLanding } from './signals';
import './style.css';

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
  surface: isLanding.peek() ? 'landing' : 'viewer',
});

const root = document.getElementById('app')!;
root.innerHTML = '';
render(<App />, root);
