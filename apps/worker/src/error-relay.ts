import { MAX_PAGE_ERRORS as N, MAX_NETWORK_ERRORS as NN, MAX_PAGE_ERROR_TEXT as T } from '@marklayer/types/relay';
import { FRAME_MESSAGE } from '../shared/frame-protocol';

/**
 * A string, not a serialised function: the Worker bundler can rewrite a function body (`__name`
 * helpers) and break `.toString()`. Twin of `errorBufferPayload` in the extension's `page-errors.ts`.
 * Posts to the viewer's `origin` only, not to whatever ends up framing the page.
 */
export const errorRelayScript = (origin: string): string =>
  `<script>(function(){var b=[],P=window.parent,t=0,post=function(){clearTimeout(t);t=setTimeout(function(){P.postMessage({type:"${FRAME_MESSAGE.errors}",errors:b},${JSON.stringify(origin)})},100)};var push=function(m,s,l){b.push({message:String(m).slice(0,${T}),source:s?String(s).split(/[?#]/)[0].slice(0,${T}):undefined,line:l||undefined,at:Date.now()});if(b.length>${N})b.shift();post()};window.addEventListener("error",function(e){if(e.message)push(e.message,e.filename,e.lineno)});window.addEventListener("unhandledrejection",function(e){var r=e.reason;push("Unhandled rejection: "+(r&&r.message!==undefined?r.message:String(r)))});var o=console.error;console.error=function(){try{push(Array.prototype.map.call(arguments,function(a){return a&&a.message!==undefined?a.message:String(a)}).join(" "))}catch(e){}return o.apply(this,arguments)};post()})()</script>`;

/** Failed fetch/XHR observations in the framed page; successful responses are never emitted. */
export const networkErrorRelayScript = (origin: string): string =>
  `<script>
  (function(){
    var b=[], page=location.href.split(/[?#]/)[0], P=window.parent, timer=0;
    function post(){clearTimeout(timer);timer=setTimeout(function(){P.postMessage({type:"${FRAME_MESSAGE.networkErrors}",errors:b},${JSON.stringify(origin)})},100)}
    function clean(raw){try{
      var u=new URL(raw,document.baseURI||location.href);u.username="";u.password="";
      var p=u.pathname.split("/").map(function(x,i,a){var prev=(a[i-1]||"").toLowerCase();
        return ["user","users","account","accounts","session","sessions","token","tokens","profile","profiles"].indexOf(prev)>=0||/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(x)||/^[a-z0-9_-]{24,}$/i.test(x)||x.indexOf("@")>=0?":id":decodeURIComponent(x)});
      return(u.origin+p.join("/")).slice(0,${T})
    }catch(e){return""}}
    function push(m,u,s,e,at){
      var current=location.href.split(/[?#]/)[0];if(current!==page){b=[];page=current}
      b.push({method:String(m||"GET").toUpperCase().slice(0,16),url:clean(u),status:s,error:e,durationMs:Math.max(0,Date.now()-at),at:Date.now()});
      if(b.length>${NN})b.shift();post()
    }
    var f=window.fetch;window.fetch=function(i,o){
      var r=i instanceof Request?i:null,m=o&&o.method||r&&r.method||"GET",u=r&&r.url||String(i),at=Date.now();
      return f.call(this,i,o).then(function(v){if(!v.ok)push(m,u,v.status,undefined,at);return v},function(e){push(m,u,undefined,e&&e.name||"NetworkError",at);throw e})
    };
    var op=XMLHttpRequest.prototype.open,sd=XMLHttpRequest.prototype.send,w=new WeakMap;
    XMLHttpRequest.prototype.open=function(m,u){w.set(this,{m:m,u:String(u)});return op.apply(this,arguments)};
    XMLHttpRequest.prototype.send=function(){var x=this,r=w.get(x);if(r){
      var at=Date.now(),done=false,fin=function(e){if(done)return;done=true;if(e)push(r.m,r.u,undefined,e,at);else if(x.status>=400)push(r.m,r.u,x.status,undefined,at)};
      x.addEventListener("loadend",function(){fin()});x.addEventListener("error",function(){fin("NetworkError")});
      x.addEventListener("timeout",function(){fin("TimeoutError")});x.addEventListener("abort",function(){fin("AbortError")})
    }return sd.apply(this,arguments)}
  })()
  </script>`;
