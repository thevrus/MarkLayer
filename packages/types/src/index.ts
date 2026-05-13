import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { z } from 'zod/mini';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// === Ops: schemas + inferred types (single source of truth) ===

export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;

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

export const freehandOpSchema = z.object({
  ...baseOp,
  tool: z.enum(['pen', 'eraser', 'highlight']),
  points: z.array(pointSchema),
  compositeOperation: z.string(),
});
export type FreehandOp = z.infer<typeof freehandOpSchema>;

export const rectOpSchema = z.object({
  ...baseOp,
  tool: z.literal('rectangle'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});
export type RectOp = z.infer<typeof rectOpSchema>;

export const lineOpSchema = z.object({
  ...baseOp,
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
  tool: z.literal('circle'),
  centerX: z.number(),
  centerY: z.number(),
  radius: z.number(),
});
export type CircleOp = z.infer<typeof circleOpSchema>;

export const commentStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'dismissed']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

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

export const commentMetaSchema = z.object({
  url: z.optional(z.string()),
  viewport: z.optional(z.object({ width: z.number(), height: z.number() })),
  browser: z.optional(z.string()),
  os: z.optional(z.string()),
});
export type CommentMeta = z.infer<typeof commentMetaSchema>;

export const commentOpSchema = z.object({
  ...baseOp,
  tool: z.literal('comment'),
  num: z.number(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  ts: z.number(),
  resolved: z.optional(z.boolean()),
  status: z.optional(commentStatusSchema),
  parentId: z.optional(z.string()),
  author: z.optional(z.string()),
  meta: z.optional(commentMetaSchema),
  assignedAgent: z.optional(z.string()),
  dismissReason: z.optional(z.string()),
  target: z.optional(targetElementSchema),
});
export type CommentOp = z.infer<typeof commentOpSchema>;

export const textOpSchema = z.object({
  ...baseOp,
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
  tool: z.literal('selection'),
  text: z.string(),
  rects: z.array(selectionRectSchema),
  comment: z.optional(z.string()),
  ts: z.number(),
  author: z.optional(z.string()),
  status: z.optional(commentStatusSchema),
  assignedAgent: z.optional(z.string()),
  dismissReason: z.optional(z.string()),
  target: z.optional(targetElementSchema),
});
export type SelectionOp = z.infer<typeof selectionOpSchema>;

/** Rectangular region annotation with optional comment — "this whole section feels off." */
export const areaOpSchema = z.object({
  ...baseOp,
  tool: z.literal('area'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  comment: z.optional(z.string()),
  ts: z.number(),
  author: z.optional(z.string()),
  status: z.optional(commentStatusSchema),
  assignedAgent: z.optional(z.string()),
  dismissReason: z.optional(z.string()),
  target: z.optional(targetElementSchema),
});
export type AreaOp = z.infer<typeof areaOpSchema>;

/**
 * Element-inspector handoff. Captures the selector, the element rect, and the full
 * markdown snapshot at the moment of inspection so an MCP-connected agent has
 * everything it needs to act without rehydrating the page.
 */
export const inspectOpSchema = z.object({
  ...baseOp,
  tool: z.literal('inspect'),
  selector: z.string(),
  tag: z.string(),
  comment: z.optional(z.string()),
  markdown: z.string(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  ts: z.number(),
  author: z.optional(z.string()),
  status: z.optional(commentStatusSchema),
  assignedAgent: z.optional(z.string()),
  dismissReason: z.optional(z.string()),
});
export type InspectOp = z.infer<typeof inspectOpSchema>;

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
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

export const opsArraySchema = z.array(drawOpSchema);

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
 */
export const RTC_MESSAGE_TYPES = ['rtc_offer', 'rtc_answer', 'rtc_ice'] as const;
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
    type: z.literal('profile'),
    name: z.optional(z.string()),
    color: z.optional(z.string()),
  }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;
