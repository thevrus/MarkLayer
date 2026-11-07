import { pxTarget } from '../px-path';
import { escapeForScript } from './script-text';

/** Sends the page's own fetch and XHR calls through `/px`. A same-origin call is the page's, never ours, unless already rewritten. */
export const fetchShimScript = ({ selfOrigin, baseUrl }: { selfOrigin: string; baseUrl: URL }): string =>
  `<script>(function(){var H="${selfOrigin}";var T="${escapeForScript(pxTarget(baseUrl))}";var S="${baseUrl.protocol === 'http:' ? 'http/' : ''}";var F=window.fetch;function _pw(s){try{var u=new URL(s,location.href);if(/^https?:$/.test(u.protocol)){if(u.origin!==location.origin)return H+"/px/"+(u.protocol==="http:"?S:"")+u.host+u.pathname+u.search;if(u.pathname!=="/"&&!/^\\/px(\\/|$)/.test(u.pathname))return H+"/px/"+T+u.pathname+u.search}}catch(e){}return null}window.fetch=function(i,o){var s=typeof i==="string"?i:i instanceof Request?i.url:String(i);var p=_pw(s);if(p)i=typeof i==="string"?p:new Request(p,i);return F.call(this,i,o)};var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){var p=_pw(String(arguments[1]));if(p)arguments[1]=p;return O.apply(this,arguments)}})()</script>`;
