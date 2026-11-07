import { FRAME_MESSAGE } from '../../../shared/frame-protocol';

/** Forwards keys with `editable` judged in the frame, the only place that can see the field. Mirrors `editableTarget` in the extension's lib/dom.ts. */
export const keysScript = ({ selfOrigin }: { selfOrigin: string }): string =>
  `<script>(function(){function ed(e){var t=e.composedPath?e.composedPath()[0]:e.target;if(!t||t.nodeType!==1)return false;var n=t.tagName;return n==="INPUT"||n==="TEXTAREA"||n==="SELECT"||t.isContentEditable===true}function f(p){return function(e){window.parent.postMessage({type:"${FRAME_MESSAGE.key}",phase:p,key:e.key,code:e.code,metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,editable:ed(e)},"${selfOrigin}")}}window.addEventListener("keydown",f("keydown"));window.addEventListener("keyup",f("keyup"))})();</script>`;
