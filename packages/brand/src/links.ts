import { ORIGIN } from './index';

/**
 * Every address the product mints or reads. One module because a route written out
 * at each call site is a route that cannot be renamed, and the ids here double as
 * credentials: what counts as one has to be the same answer everywhere.
 */

/**
 * An anonymous upload's id. The Worker mints and validates these while the viewer has
 * to recognise one in a stored `url`; the length tracks `nanoid()`'s default.
 * Deliberately the only same-origin path the viewer accepts as a document: the id
 * charset excludes `/`, `.` and `?`, so a crafted `url` can never walk out of `/f/`.
 */
const UPLOAD_ID = /^[A-Za-z0-9_-]{21}$/;
const UPLOAD_ROOT = '/f/';

/**
 * A share id the API will mint a *new* room at. 12 of a 64-symbol charset is 72
 * bits, past what guessing reaches with no rate limit in front of it; `nanoid()`
 * gives 21. Only creation is checked, so a shorter id already in D1 keeps
 * resolving. The cap keeps it sane as a primary key and still takes a UUID.
 */
export const MIN_SHARE_ID_LENGTH = 12;
export const MAX_SHARE_ID_LENGTH = 64;
const SHARE_ID_CHARS = '[A-Za-z0-9_-]';
const NEW_SHARE_ID = new RegExp(`^${SHARE_ID_CHARS}{${MIN_SHARE_ID_LENGTH},${MAX_SHARE_ID_LENGTH}}$`);
const ANY_SHARE_ID = new RegExp(`^${SHARE_ID_CHARS}{1,${MAX_SHARE_ID_LENGTH}}$`);

export const isUploadId = (id: string): boolean => UPLOAD_ID.test(id);

/** Whether the API may create a room at this id. Reads do not use this: see `isShareId`. */
export const isNewShareId = (id: string): boolean => NEW_SHARE_ID.test(id);

/** Whether a room could exist at this id. No length floor: that guards minting, and
 * rooms made before it existed still resolve. */
export const isShareId = (id: string): boolean => ANY_SHARE_ID.test(id);

export const uploadPath = (id: string): string => `${UPLOAD_ROOT}${id}`;
export const isUploadPath = (url: string): boolean =>
  url.startsWith(UPLOAD_ROOT) && isUploadId(url.slice(UPLOAD_ROOT.length));

export const sharePath = (id: string): string => `/s/${id}`;

/**
 * Where a share link was made, carried on the link itself as `?ref=`, so "did anyone
 * act on what I sent" can be answered by joining the viewer's events to the label.
 */
export const SHARE_REFS = ['web', 'ext', 'dash', 'button', 'widget'] as const;
export type ShareRef = (typeof SHARE_REFS)[number];

/** An allow-list, because the value arrives from the address bar: anything wider lets a stranger write free text into telemetry. */
export function parseShareRef(value: string | null): ShareRef | null {
  return SHARE_REFS.find((ref) => ref === value) ?? null;
}

/** Params, not concatenation: these links already carry `?readonly=1` and `?page=`. */
export function withShareRef({ url, ref }: { url: string; ref: ShareRef }): string {
  const stamped = new URL(url);
  stamped.searchParams.set('ref', ref);
  return stamped.toString();
}

/** The one spelling of a share link, so a field cannot show a different link than the one copied. */
export function shareUrl({
  origin,
  kind,
  id,
  readonly = false,
  ref,
}: {
  origin: string;
  kind: 'project' | 'page';
  id: string;
  readonly?: boolean;
  ref: ShareRef;
}): string {
  const path = kind === 'project' ? `/p/${id}` : sharePath(id);
  return withShareRef({ url: `${origin}${path}${readonly ? '?readonly=1' : ''}`, ref });
}

/** `/p/:id` opened at page `idx`, keeping the rest of the share link's query. */
export function projectPagePath({
  projectId,
  idx,
  search,
}: {
  projectId: string;
  idx: number;
  search: string;
}): string {
  const params = new URLSearchParams(search);
  if (idx === 0) params.delete('page');
  else params.set('page', String(idx));
  const qs = params.toString();
  return `/p/${projectId}${qs ? `?${qs}` : ''}`;
}

/** Where a room answers MCP. The share link is the address, so there is nothing to install. */
export const mcpEndpoint = ({ origin = ORIGIN, roomId }: { origin?: string; roomId: string }): string =>
  `${origin}${sharePath(roomId)}/mcp`;

export const mcpAddCommand = ({ origin = ORIGIN, roomId }: { origin?: string; roomId: string }): string =>
  `claude mcp add --transport http marklayer ${mcpEndpoint({ origin, roomId })}`;

/** The width a page is locked to when nothing recorded one. */
export const DEFAULT_WIDTH = 1280;

const ANT_HASH = '#ant=';

/** A live page's own URL carrying its room: `#ant=<width>=<id>`, what the extension resumes from. */
export const antHash = {
  build: ({ width, id }: { width: number; id: string }): string =>
    `${ANT_HASH}${width > 0 ? width : DEFAULT_WIDTH}=${id}`,

  parse(hash: string): { width: number; id: string } | null {
    if (!hash.startsWith(ANT_HASH)) return null;
    const [rawWidth, id, ...rest] = hash.slice(ANT_HASH.length).split('=');
    if (rawWidth === undefined || id === undefined || rest.length > 0) return null;
    const width = Number.parseInt(rawWidth, 10);
    return width > 0 ? { width, id } : null;
  },
};

const MAX_OG_HEADING = 200;
const MAX_OG_PATH = 120;

/**
 * A card drawn for one marketing page. Rendered by the Worker because the fonts and
 * rasterizer live there; the heading travels in the query because these pages are
 * static and the Worker has no copy of their content. Caller-supplied either way,
 * so `parse` clamps what `build` sent before it can turn into work.
 */
export const pageOgImage = {
  build: ({ origin = ORIGIN, heading, path }: { origin?: string; heading: string; path: string }): string =>
    `${origin}/og/page.png?${new URLSearchParams({ h: heading, p: path })}`,

  parse(query: URLSearchParams): { heading: string; path: string } | null {
    const heading = (query.get('h') ?? '').slice(0, MAX_OG_HEADING).replace(/\p{C}/gu, ' ').trim();
    if (!heading) return null;
    return { heading, path: (query.get('p') ?? '/').slice(0, MAX_OG_PATH).replace(/\p{C}/gu, '').trim() };
  },
};

/** `https://www.example.com/a` → `example.com`, or null when it is not a URL. */
export function displayHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function roomIdFromUrl(value: string): string | null {
  // A pasted link often arrives without its scheme, and the bare-id path in
  // `parseRoomRef` would reject it on the slash, so try both spellings.
  for (const candidate of [value, `https://${value}`]) {
    try {
      const match = /^\/s\/([^/]+)/.exec(new URL(candidate).pathname);
      if (match?.[1]) return match[1];
    } catch {
      // not a URL in this spelling
    }
  }
  return null;
}

/**
 * A room id out of whatever someone pasted: a bare id, a share link, or the room's
 * `/mcp` address. Null when it holds none; a caller with an agent to answer words its own error.
 */
export function parseRoomRef(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = roomIdFromUrl(trimmed) ?? trimmed;
  // `isShareId`, not `isNewShareId`: a room made before that floor existed still resolves.
  return isShareId(candidate) ? candidate : null;
}
