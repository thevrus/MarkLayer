/**
 * A DOM for `bun test`. Almost everything in `lib/` reads the document —
 * `state.ts` touches `location.href` at import time, so the globals have to
 * exist before any module under test is loaded, which is what a preload is for.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'https://example.com/page' });
