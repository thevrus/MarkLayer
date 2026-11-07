import { FRAME_MESSAGE } from '../../../shared/frame-protocol';

/** Tells the viewer the proxy's scripts ran, so it can wait on a message rather than a timer. */
export const readyScript = ({ selfOrigin }: { selfOrigin: string }): string =>
  `<script>window.parent.postMessage({type:"${FRAME_MESSAGE.ready}"},"${selfOrigin}")</script>`;
