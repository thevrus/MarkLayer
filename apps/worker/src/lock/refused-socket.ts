/**
 * Refuses a socket the way a browser can read. A plain 401 on the upgrade surfaces
 * as close code 1006, indistinguishable from a network drop, and the client retries
 * forever; accepting and closing with an app code tells it to stop.
 */
export function refusedSocket({ code, reason }: { code: number; reason: string }): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
