/** `history` calls throw on a document whose URL we rewrote; a page should not die of that. */
export const historyGuardScript = (): string =>
  `<script>(function(){var r=history.replaceState,p=history.pushState;history.replaceState=function(){try{return r.apply(this,arguments)}catch(e){}};history.pushState=function(){try{return p.apply(this,arguments)}catch(e){}};})();</script>`;
