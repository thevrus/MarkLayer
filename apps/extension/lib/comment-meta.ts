import { errorsForPage } from './page-errors';
import { annotatedUrl } from './page-url';
import type { CommentMeta } from './types';

const BROWSERS: [string, string][] = [
  ['Firefox/', 'Firefox'],
  ['Edg/', 'Edge'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];
const OS_HINTS: [string, string][] = [
  ['Mac OS', 'macOS'],
  ['Windows', 'Windows'],
  ['Linux', 'Linux'],
  ['Android', 'Android'],
  ['iPhone', 'iOS'],
  ['iPad', 'iOS'],
];

// Cache browser/OS detection — UA doesn't change mid-session
let cachedUA: { browser: string; os: string } | undefined;
function detectUA() {
  const ua = navigator.userAgent;
  cachedUA ??= {
    browser: BROWSERS.find(([hint]) => ua.includes(hint))?.[1] ?? 'Unknown',
    os: OS_HINTS.find(([hint]) => ua.includes(hint))?.[1] ?? 'Unknown',
  };
  return cachedUA;
}

export function getCommentMeta(): CommentMeta {
  const errors = errorsForPage();
  return {
    url: annotatedUrl.value || location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ...detectUA(),
    ...(errors.length > 0 && { errors }),
  };
}
