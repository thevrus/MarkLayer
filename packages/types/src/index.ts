import { createCn } from 'cnfast';
import { z } from 'zod/mini';

export type { ClassValue } from 'cnfast';

/**
 * The type scale's names, taught to the class merger.
 *
 * `cn` is clsx + tailwind-merge (via cnfast, ~3.8x faster with byte-identical
 * output). tailwind-merge resolves an unrecognised `text-*` to the *colour*
 * group, which has a catch-all matcher — so `cn('text-meta', 'text-inherit')`
 * silently dropped the size and the element fell back to the inherited 16px.
 * Every size below is a `--text-*` key in the two @theme blocks
 * (apps/worker/web/style.css, apps/extension/entrypoints/content/style.css);
 * keep this list in step with them.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'micro',
            'mini',
            'meta',
            'ui',
            'ui-lg',
            'body',
            'lede',
            'heading',
            'title',
            'fine',
            'label',
            'display',
            'hero',
            'closing',
            'statement',
            'section',
            'subsection',
          ],
        },
      ],
    },
  },
});
export type { FetchableUrl, UnfetchableReason } from './net';
export { isBlockedHost, isPrivateAddress, parseFetchableUrl } from './net';

/**
 * An anonymous upload's id and the path it is served at. Shared because the
 * Worker mints and validates ids while the viewer has to recognise one in a
 * stored `url`; the length tracks `nanoid()`'s default. Deliberately the only
 * same-origin path the viewer accepts as a document — the id charset excludes
 * `/`, `.` and `?`, so a crafted `url` can never walk out of `/f/`.
 */
const UPLOAD_ID = /^[A-Za-z0-9_-]{21}$/;

/** The cap on an anonymous upload. Enforced server-side; shown client-side. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const isUploadId = (id: string): boolean => UPLOAD_ID.test(id);
export const uploadPath = (id: string): string => `/f/${id}`;
export const isUploadPath = (url: string): boolean => url.startsWith('/f/') && isUploadId(url.slice(3));

// === Ops: schemas + inferred types (single source of truth) ===

export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;

/**
 * How far an arrow head reaches back from the tip, at the width the shaft is
 * stroked at. Also the padding a culling box needs, since the head extends past
 * the endpoint at any angle.
 */
export const arrowHeadLength = (lineWidth: number) => Math.max(10, lineWidth * 4);

/**
 * The two barbs of an arrow head. Pure geometry, kept here because five surfaces
 * draw this same arrow — the live canvas preview, the committed render, the
 * landing demo, the cull-padding estimate and the OG card — and a barb angle
 * changed in one of them is an arrow that disagrees with itself.
 */
export function arrowHeadBarbs({
  start,
  end,
  lineWidth,
}: {
  start: Point;
  end: Point;
  lineWidth: number;
}): [Point, Point] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const len = arrowHeadLength(lineWidth);
  const barb = (offset: number): Point => ({
    x: end.x - len * Math.cos(angle + offset),
    y: end.y - len * Math.sin(angle + offset),
  });
  return [barb(-Math.PI / 6), barb(Math.PI / 6)];
}

export const deviceModeSchema = z.enum(['desktop', 'tablet', 'mobile']);
export type DeviceMode = z.infer<typeof deviceModeSchema>;

/**
 * Viewport (in CSS pixels) of the window/iframe the annotation was drawn on.
 * Used at render time to scale or reproject ops when the current viewport
 * differs from the one the user drew on (different screen size, device mode,
 * iframe width). Optional for backwards compat with pre-anchor ops.
 */
export const captureViewportSchema = z.object({ width: z.number(), height: z.number() });
export type CaptureViewport = z.infer<typeof captureViewportSchema>;

const baseOp = {
  id: z.string(),
  color: z.string(),
  lineWidth: z.number(),
  /** Viewport size this annotation was drawn on */
  device: z.optional(deviceModeSchema),
  captureViewport: z.optional(captureViewportSchema),
};

export interface BaseOp {
  id: string;
  color: string;
  lineWidth: number;
  device?: DeviceMode;
  captureViewport?: CaptureViewport;
}

/**
 * Element context attached to an annotation so an MCP-connected agent can locate
 * what was being referenced without round-tripping back to the page. `markdown`
 * is the same `formatForAI()` payload the Inspect tool uses, so all annotation
 * tools converge on a single agent-readable shape.
 */
export const targetElementSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  markdown: z.string(),
  rect: z.optional(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })),
  /**
   * Element-local offset from the target's top-left (in document px) to the
   * annotation's anchor point at capture time. Lets the renderer reproject the
   * annotation when the page reflows: `current_element_rect + offset`.
   * Both fields present together or both absent.
   */
  offsetX: z.optional(z.number()),
  offsetY: z.optional(z.number()),
  /**
   * Normalized text fingerprint (first ~50 chars of trimmed innerText) used
   * as a fallback resolver strategy when the primary selector no longer
   * matches a unique element — e.g. a class redesign churned the selector
   * but the visible label didn't change.
   */
  text: z.optional(z.string()),
});
export type TargetElement = z.infer<typeof targetElementSchema>;

/**
 * Anchor for an annotation drawn on a PDF, as a fraction of its page box.
 * A PDF has no stable element to bind to: pdf.js tears down offscreen pages
 * and rebuilds the text layer's spans at every zoom level, so both halves of
 * `targetElement` — the selector and the element-local offset — go stale. The
 * page number plus a 0..1 fraction survives all of it, and reprojects with a
 * multiply. Absent on ops drawn over ordinary web pages.
 */
export const pdfAnchorSchema = z.object({
  /** 1-based, matching how PDF pages are numbered everywhere a user sees them. */
  page: z.number(),
  x: z.number(),
  y: z.number(),
});

export type PdfAnchor = z.infer<typeof pdfAnchorSchema>;

/**
 * Mixed into every op that can be bound to a page element, so adding an
 * anchorable tool is one spread rather than a remembered line. Optional for
 * backwards compat with ops recorded before anchoring existed. `pdf` is the
 * same idea for PDFs, and the two are mutually exclusive in practice.
 */
const anchorable = { target: z.optional(targetElementSchema), pdf: z.optional(pdfAnchorSchema) };

export const freehandOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  tool: z.enum(['pen', 'eraser', 'highlight']),
  points: z.array(pointSchema),
  compositeOperation: z.string(),
});
export type FreehandOp = z.infer<typeof freehandOpSchema>;

export const rectOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  tool: z.literal('rectangle'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});
export type RectOp = z.infer<typeof rectOpSchema>;

export const lineOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  tool: z.literal('line'),
  arrow: z.optional(z.boolean()),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});
export type LineOp = z.infer<typeof lineOpSchema>;

export const circleOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  tool: z.literal('circle'),
  centerX: z.number(),
  centerY: z.number(),
  radius: z.number(),
});
export type CircleOp = z.infer<typeof circleOpSchema>;

/**
 * `resolved` and `approved` are two halves of one handoff, not synonyms: whoever
 * did the work marks it resolved, and whoever asked for it confirms with approved.
 * Without the second value a review has no ending the requester owns — the person
 * who fixed the thing is also the person who declares it done.
 */
export const commentStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'approved', 'dismissed']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/**
 * Triage priority for any annotation that carries a comment (comment pins, area
 * notes, selection notes, element-inspector handoffs). Absent = no priority set.
 * Ordered low → urgent; the renderer maps each level to a color + signal icon.
 */
export const commentPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type CommentPriority = z.infer<typeof commentPrioritySchema>;

export const commentMetaSchema = z.object({
  url: z.optional(z.string()),
  viewport: z.optional(z.object({ width: z.number(), height: z.number() })),
  browser: z.optional(z.string()),
  os: z.optional(z.string()),
});
export type CommentMeta = z.infer<typeof commentMetaSchema>;

/**
 * Who wrote it. `author` is a display name, so it is only ever a snapshot of
 * what the person was called at the time; `authorId` is stable per browser, and
 * it is what lets a rename find the work it has to follow. Ops written before
 * `authorId` existed carry only the name.
 */
const authored = {
  author: z.optional(z.string()),
  authorId: z.optional(z.string()),
};

/** Triage state carried by every annotation that owns a comment thread. */
const triageable = {
  status: z.optional(commentStatusSchema),
  /** Nullable for the same reason as `assignee`: a cleared priority has to reach
   * peers as an explicit null, since a dropped key reads as "unchanged". */
  priority: z.optional(z.nullable(commentPrioritySchema)),
  /** Display name of the person the thread is assigned to. Nullable (not just
   * optional) so an unassign survives JSON serialization on the wire. */
  assignee: z.optional(z.nullable(z.string())),
  assignedAgent: z.optional(z.string()),
  dismissReason: z.optional(z.string()),
};

export const commentOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  ...triageable,
  tool: z.literal('comment'),
  num: z.number(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  ts: z.number(),
  resolved: z.optional(z.boolean()),
  parentId: z.optional(z.string()),
  ...authored,
  meta: z.optional(commentMetaSchema),
});
export type CommentOp = z.infer<typeof commentOpSchema>;

export const textOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  tool: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  fontSize: z.number(),
});
export type TextOp = z.infer<typeof textOpSchema>;

export const selectionRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type SelectionRect = z.infer<typeof selectionRectSchema>;

export const selectionOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  ...triageable,
  tool: z.literal('selection'),
  text: z.string(),
  rects: z.array(selectionRectSchema),
  comment: z.optional(z.string()),
  /**
   * Proposed replacement for `text` — the annotation is a copy edit rather than a
   * note about one. Separate from `comment` so consumers can render and export it
   * as a diff an agent can apply, instead of parsing the intent out of prose.
   */
  suggestion: z.optional(z.string()),
  ts: z.number(),
  ...authored,
});
export type SelectionOp = z.infer<typeof selectionOpSchema>;

/**
 * Reduce a suggestion input to what belongs on the op: `undefined` unless it
 * actually differs from the text it replaces, so no reader ever has to render a
 * diff with identical sides. An empty field reads as "no edit proposed" rather
 * than "replace this with nothing" — deleting copy is what the comment is for.
 */
export function normalizeSuggestion({
  text,
  suggestion,
}: {
  text: string;
  suggestion: string | null | undefined;
}): string | undefined {
  const trimmed = suggestion?.trim();
  if (!trimmed || trimmed === text.trim()) return undefined;
  return trimmed;
}

/** Rectangular region annotation with optional comment — "this whole section feels off." */
export const areaOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  ...triageable,
  tool: z.literal('area'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  comment: z.optional(z.string()),
  ts: z.number(),
  ...authored,
});
export type AreaOp = z.infer<typeof areaOpSchema>;

/**
 * Element-inspector handoff. Captures the selector, the element rect, and the full
 * markdown snapshot at the moment of inspection so an MCP-connected agent has
 * everything it needs to act without rehydrating the page.
 */
export const inspectOpSchema = z.object({
  ...baseOp,
  ...triageable,
  tool: z.literal('inspect'),
  selector: z.string(),
  tag: z.string(),
  comment: z.optional(z.string()),
  markdown: z.string(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  ts: z.number(),
  ...authored,
});
export type InspectOp = z.infer<typeof inspectOpSchema>;

/**
 * Figma-style ruler guide — a viewport-wide horizontal or vertical line stored
 * in document coords. Lives in the op stream so it persists with the rest of
 * the annotation (localStorage draft, D1, peer broadcast). `color`/`lineWidth`
 * come from baseOp but the renderer ignores them — guides have a fixed style.
 */
export const guideOpSchema = z.object({
  ...baseOp,
  tool: z.literal('guide'),
  orientation: z.enum(['horizontal', 'vertical']),
  position: z.number(),
});
export type GuideOp = z.infer<typeof guideOpSchema>;

export const drawOpSchema = z.discriminatedUnion('tool', [
  freehandOpSchema,
  rectOpSchema,
  lineOpSchema,
  circleOpSchema,
  commentOpSchema,
  textOpSchema,
  selectionOpSchema,
  areaOpSchema,
  inspectOpSchema,
  guideOpSchema,
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

export const opsArraySchema = z.array(drawOpSchema);

/**
 * The op's representative anchor point in document px — the coordinate that was
 * resolved against the target element at capture time. Renderers use it to
 * measure how far that anchor has drifted and shift the whole op by the delta.
 *
 * The switch is exhaustive on purpose: a new tool has to declare its anchor
 * point (or explicitly opt out) rather than compile, ship, and silently never
 * anchor. Ops that return null carry their own geometry (area/selection rects,
 * inspect rect) or span the viewport (guides).
 */
export function opAnchorPoint(op: DrawOp): Point | null {
  switch (op.tool) {
    case 'pen':
    case 'eraser':
    case 'highlight':
      return op.points[0] ?? null;
    case 'rectangle':
    case 'line':
      return { x: op.startX, y: op.startY };
    case 'circle':
      return { x: op.centerX, y: op.centerY };
    case 'text':
      return { x: op.x, y: op.y };
    case 'comment':
    case 'selection':
    case 'area':
    case 'inspect':
    case 'guide':
      return null;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * `op` shifted by a viewport delta, or null for the ops that cannot meaningfully
 * be moved as a copy: a comment owns a thread, a selection owns a text range, an
 * inspect owns an element handoff, a guide owns an axis, and an eraser stroke is a
 * subtraction from the strokes beneath it.
 *
 * Which fields of an op are coordinates is op-schema knowledge, so it lives here
 * beside `opAnchorPoint` rather than in a host — the `never` guard then makes a new
 * tool declare how it translates instead of compiling and silently not moving.
 * The caller owns identity: it supplies the new `id` and decides what happens to
 * `target` (a re-resolved element anchor would snap the copy back and eat the delta).
 */
export function translateOp({ op, dx, dy }: { op: DrawOp; dx: number; dy: number }): DrawOp | null {
  const shiftBox = (o: { startX: number; startY: number; endX: number; endY: number }) => ({
    startX: o.startX + dx,
    startY: o.startY + dy,
    endX: o.endX + dx,
    endY: o.endY + dy,
  });
  switch (op.tool) {
    case 'pen':
    case 'highlight':
      return { ...op, points: op.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
    case 'rectangle':
    case 'line':
    case 'area':
      return { ...op, ...shiftBox(op) };
    case 'circle':
      return { ...op, centerX: op.centerX + dx, centerY: op.centerY + dy };
    case 'text':
      return { ...op, x: op.x + dx, y: op.y + dy };
    case 'eraser':
    case 'comment':
    case 'selection':
    case 'inspect':
    case 'guide':
      return null;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/** The ops that own a comment thread, and so carry triage state. */
export type AnnotationOp = CommentOp | SelectionOp | InspectOp | AreaOp;

export function isAnnotationOp(op: DrawOp): op is AnnotationOp {
  return op.tool === 'comment' || op.tool === 'selection' || op.tool === 'inspect' || op.tool === 'area';
}

/**
 * Where this annotation sits: its top-left in document px.
 *
 * Distinct from `opAnchorPoint`, which is the element-anchoring coordinate and
 * is deliberately null for exactly these ops. This is the human answer — where
 * the panel scrolls to, where the board sorts by, where a reply pin lands.
 *
 * Here rather than in a host because four surfaces ask it — the panel, the
 * board, the detail view and the MCP server — and each deriving it separately is
 * how they came to disagree: an area dragged right-to-left has `endX < startX`,
 * so the raw `startX` is its *right* edge, not its anchor.
 */
export function opAnchor(op: AnnotationOp): Point {
  switch (op.tool) {
    case 'comment':
      return { x: op.x, y: op.y };
    case 'selection': {
      const first = op.rects[0];
      return { x: first?.x ?? 0, y: first?.y ?? 0 };
    }
    case 'area':
      return { x: Math.min(op.startX, op.endX), y: Math.min(op.startY, op.endY) };
    case 'inspect':
      return { x: op.rect.x, y: op.rect.y };
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * Collapse the legacy `resolved` boolean (comments only, written before `status`
 * existed) and an unset `status` into the canonical value. Panels, pins and the
 * MCP listers all filter on this, so it has to be one definition or the surfaces
 * disagree about what is resolved.
 */
export function resolveOpStatus(op: AnnotationOp): CommentStatus {
  if (op.tool === 'comment') return op.status || (op.resolved ? 'resolved' : 'open');
  return op.status || 'open';
}

/**
 * Both endings of a thread. `approved` is `resolved` one step further on, so
 * every surface that dims, strikes through or drops an unread-reply count wants
 * both — and each one deciding that for itself is how the extension pin and the
 * web pin came to disagree about an approved comment.
 */
export function isSettled(status: CommentStatus): boolean {
  return status === 'resolved' || status === 'approved';
}

/**
 * Merge a wire patch into an op and re-validate the result, returning null if the
 * patch would produce something that is no longer a valid op.
 *
 * `update_op` carries an unconstrained `Record<string, unknown>` — the envelope is
 * validated but the patch body cannot be, since it is a partial of a discriminated
 * union. Re-parsing the merged op is what keeps a malformed patch from being
 * broadcast to peers and flushed to storage.
 */
export function applyOpPatch({ op, patch }: { op: unknown; patch: object }): DrawOp | null {
  if (typeof op !== 'object' || op === null) return null;
  const merged = drawOpSchema.safeParse({ ...op, ...patch });
  return merged.success ? merged.data : null;
}

/** Peer presence for live cursors. Runtime-only state — not on the wire. */
export interface Peer {
  id: string;
  name: string;
  color: string;
  cursor: Point | null;
  tool?: string;
  lastSeen: number;
}

// === Wire protocol ===

/**
 * RTC signaling carries arbitrary SDP/ICE blobs that we forward verbatim.
 * Match these types separately and pass through; do not run them through `clientMsgSchema`.
 *
 * `rtc_request_ice` is a client→server fan-in (no `to:` field); the server replies
 * with a server-only `ice_refresh` push.
 */
export const RTC_MESSAGE_TYPES = ['rtc_offer', 'rtc_answer', 'rtc_ice', 'rtc_request_ice'] as const;
export type RtcMessageType = (typeof RTC_MESSAGE_TYPES)[number];

/**
 * Operational client→server messages, strictly validated at the WS boundary.
 * Excludes RTC signaling (see RTC_MESSAGE_TYPES).
 */
export const clientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('op'), op: drawOpSchema }),
  z.object({
    type: z.literal('update_op'),
    opId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('undo'), opId: z.string() }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('cursor'),
    x: z.number(),
    y: z.number(),
    tool: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('ripple'),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('profile'),
    name: z.optional(z.string()),
    color: z.optional(z.string()),
  }),
  /**
   * "Everyone follow me." Follow mode already lets one person opt into another's
   * scroll; this is the presenter pulling the room instead of asking each person
   * to click. It only sets what a follower could have set themselves, and any
   * scroll or click releases them, so it grants no control they cannot take back.
   */
  z.object({ type: z.literal('flock'), on: z.boolean() }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;

// === Outbound integrations ===

/**
 * Destinations a room can post to. Each one is rendered by a pure provider module
 * in apps/worker/src/integrations, which describes a request but never makes one
 * — see docs/adr/0003-outbound-integrations.md.
 */
export const integrationProviderSchema = z.enum(['slack', 'teams', 'discord', 'webhook', 'linear', 'github', 'jira']);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

/**
 * One configured destination. `config` stays unknown here on purpose: its shape
 * belongs to the provider, which parses it with its own schema at the delivery
 * boundary, so adding a provider needs no change to this file.
 */
export const integrationSchema = z.object({
  provider: integrationProviderSchema,
  config: z.record(z.string(), z.unknown()),
});
export type Integration = z.infer<typeof integrationSchema>;

/** Everything a room posts to. Stored as one JSON column, so a new provider needs no migration. */
export const roomIntegrationsSchema = z.array(integrationSchema);

/** Ceiling on destinations per room — enough for a team, low enough to bound a flush. */
export const MAX_INTEGRATIONS_PER_ROOM = 5;

/**
 * One field of a provider's config, as the client needs to render it.
 *
 * `secret` is `text` that the client must not echo back: an issue tracker is
 * configured with an API token, not a URL carrying one, and a token sitting in a
 * readable input is a token read over someone's shoulder. It is an enum rather
 * than a string because `type !== 'secret'` is the check that keeps a credential
 * out of the room's stored config, in five places on the client and one on the
 * server — a free-form string would let a rename compile straight past all six.
 */
export const configFieldInfoSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['url', 'text', 'secret']),
  placeholder: z.optional(z.string()),
  help: z.optional(z.string()),
  helpUrl: z.optional(z.string()),
});
export type ConfigFieldInfo = z.infer<typeof configFieldInfoSchema>;

/**
 * A destination as `GET /api/providers` describes it.
 *
 * The client ships one generic form driven by this, so adding a provider costs
 * the client bundle nothing — see docs/adr/0003. Here rather than in the web app
 * because it is wire data, and this file is where wire data is defined and
 * parsed; the OpenAPI mirror in api.ts stays hand-written because
 * `@hono/zod-openapi` is a different builder (see CLAUDE.md).
 */
export const providerInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  blurb: z.string(),
  /** `auto` posts every batch the room produces; `manual` files only on request. */
  trigger: z.enum(['auto', 'manual']),
  fields: z.array(configFieldInfoSchema),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

export const providerCatalogueSchema = z.object({ providers: z.array(providerInfoSchema) });

/** A configured destination as the server describes it — never its credentials. */
export const destinationSummarySchema = z.object({ provider: z.string(), hint: z.nullable(z.string()) });
export type DestinationSummary = z.infer<typeof destinationSummarySchema>;

export const destinationListSchema = z.object({ integrations: z.array(destinationSummarySchema) });

/**
 * Days of inactivity before a share link and its OG card are deleted. The
 * cleanup cron enforces it; the viewer quotes it back to the user, so both read
 * it from here rather than each hand-typing "90 days".
 */
export const RETENTION_DAYS = 90;
