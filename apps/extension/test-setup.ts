/**
 * A DOM for `bun test`. Almost everything in `lib/` reads the document —
 * `initHost` and the component tests reach for it, so the globals have to exist
 * before any module under test is loaded, which is what a preload is for.
 */

import { mock } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';

// Base UI must resolve to Preact before any test imports a component using it.
const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);

GlobalRegistrator.register({ url: 'https://example.com/page' });
