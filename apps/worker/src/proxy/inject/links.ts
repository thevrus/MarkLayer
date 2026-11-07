import { FRAME_MESSAGE } from '../../../shared/frame-protocol';

/** Hands link clicks to the viewer, which navigates to the real target rather than a proxied one. */
export const linksScript = ({ selfOrigin }: { selfOrigin: string }): string =>
  `<script>(function(){document.addEventListener("click",function(e){var a=e.target.closest?e.target.closest("a"):null;if(!a)return;var h=a.href;if(!h||h.indexOf("javascript:")===0||h.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"${FRAME_MESSAGE.navigate}",url:h},"${selfOrigin}")},true)})();</script>`;
