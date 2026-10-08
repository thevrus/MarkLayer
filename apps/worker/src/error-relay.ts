import { MAX_PAGE_ERRORS as N, MAX_PAGE_ERROR_TEXT as T } from '@marklayer/types';

/**
 * A string, not a serialised function: the Worker bundler can rewrite a function body (`__name`
 * helpers) and break `.toString()`. Twin of `errorBufferPayload` in the extension's `page-errors.ts`.
 * Posts to the viewer's `origin` only, not to whatever ends up framing the page.
 */
export const errorRelayScript = (origin: string): string =>
  `<script>(function(){var b=[],P=window.parent,t=0,post=function(){clearTimeout(t);t=setTimeout(function(){P.postMessage({type:"ml-errors",errors:b},${JSON.stringify(origin)})},100)};var push=function(m,s,l){b.push({message:String(m).slice(0,${T}),source:s?String(s).split(/[?#]/)[0].slice(0,${T}):undefined,line:l||undefined,at:Date.now()});if(b.length>${N})b.shift();post()};window.addEventListener("error",function(e){if(e.message)push(e.message,e.filename,e.lineno)});window.addEventListener("unhandledrejection",function(e){var r=e.reason;push("Unhandled rejection: "+(r&&r.message!==undefined?r.message:String(r)))});var o=console.error;console.error=function(){try{push(Array.prototype.map.call(arguments,function(a){return a&&a.message!==undefined?a.message:String(a)}).join(" "))}catch(e){}return o.apply(this,arguments)};post()})()</script>`;
