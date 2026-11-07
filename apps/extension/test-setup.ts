/**
 * A DOM for `bun test`. Almost everything in `lib/` reads the document —
 * `initHost` and the component tests reach for it, so the globals have to exist
 * before any module under test is loaded, which is what a preload is for.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'https://example.com/page' });
