import posthog from 'posthog-js';
import { render } from 'preact';
import { App } from './App';
import './style.css';

const phKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const phHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
if (phKey) {
  posthog.init(phKey, {
    api_host: phHost,
    defaults: '2026-01-30',
    ip: false,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    capture_exceptions: true,
  });
}

const root = document.getElementById('app')!;
root.innerHTML = '';
render(<App />, root);
