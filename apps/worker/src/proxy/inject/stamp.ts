import { MARKLAYER_MARKER, MARKLAYER_MARKER_VALUE } from '../../../shared/frame-protocol';
import { escapeForScript } from './script-text';

/** Marks the document as ours, restores the target's own path, and keeps the page's service worker from installing here. */
export const stampScript = ({ origPath }: { origPath: string }): string =>
  `<script>document.documentElement.dataset.${MARKLAYER_MARKER}="${MARKLAYER_MARKER_VALUE}";history.replaceState(null,"","${escapeForScript(origPath)}");navigator.serviceWorker&&(navigator.serviceWorker.register=function(){return Promise.resolve()});</script>`;
