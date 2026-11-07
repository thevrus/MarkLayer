/**
 * `/px/<scheme>/<host>/...`, and the older `/px/<host>/...` that reads as https.
 *
 * Only http is ever emitted with its scheme: an https page keeps the short form, so what
 * we write into a page changes only for the http pages that were being forced to https.
 * Both forms are served. A one-label host called `http` or `https` is not a public site,
 * so the leading segment is never ambiguous.
 */
export function parsePxPath(path: string): { scheme: 'http' | 'https'; host: string; rest: string } {
  const [first] = path.split('/', 1);
  const scheme = first === 'http' || first === 'https' ? first : null;
  const tail = scheme ? path.slice(scheme.length + 1) : path;
  const slash = tail.indexOf('/');
  return {
    scheme: scheme ?? 'https',
    host: slash >= 0 ? tail.slice(0, slash) : tail,
    rest: slash >= 0 ? tail.slice(slash) : '/',
  };
}

/** What follows `/px/` for a page or resource at `url`. */
export const pxTarget = (url: URL): string => (url.protocol === 'http:' ? `http/${url.host}` : url.host);
