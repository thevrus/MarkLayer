/**
 * The landing page's public board: one room every visitor draws on, embedded
 * in the product screenshot's place. The worker creates it on first request
 * and wipes it hourly, so a stranger's mark never outlives the hour.
 */
export const DEMO_ROOM = {
  id: 'marklayer-live-demo-board',
  url: 'https://en.wikipedia.org/wiki/Web_annotation',
  // The width the page is locked to, which sets how zoomed-in it reads: the
  // viewer upscales it to fill, capped at MAX_AUTO_UPSCALE, and a 1280 lock hit
  // that cap on a wide screen and letterboxed the frame in grey. Stays under
  // Wikipedia's own 1596px container so the page still fills it edge to edge.
  width: 1600,
} as const;

/**
 * A share path names its room, and the room id is the credential, so telemetry
 * reports `/s/:id` for any room but the public demo.
 */
export function redactSharePath(path: string): string {
  return path.replace(/^\/s\/([^/?#]+)/, (whole, id) => (id === DEMO_ROOM.id ? whole : '/s/:id'));
}
