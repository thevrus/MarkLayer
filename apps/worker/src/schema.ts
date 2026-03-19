import { z } from 'zod/v4-mini';

const point = z.object({ x: z.number(), y: z.number() });

const base = {
  id: z.string(),
  color: z.string(),
  lineWidth: z.number(),
};

const freehandOp = z.object({
  ...base,
  tool: z.enum(['pen', 'eraser', 'highlight']),
  points: z.array(point),
  compositeOperation: z.string(),
});

const rectOp = z.object({
  ...base,
  tool: z.literal('rectangle'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});

const lineOp = z.object({
  ...base,
  tool: z.literal('line'),
  arrow: z.optional(z.boolean()),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});

const circleOp = z.object({
  ...base,
  tool: z.literal('circle'),
  centerX: z.number(),
  centerY: z.number(),
  radius: z.number(),
});

const commentStatusEnum = z.enum(['open', 'in_progress', 'resolved']);

const commentMeta = z.object({
  url: z.optional(z.string()),
  viewport: z.optional(z.object({ width: z.number(), height: z.number() })),
  browser: z.optional(z.string()),
  os: z.optional(z.string()),
});

const commentOp = z.object({
  ...base,
  tool: z.literal('comment'),
  num: z.number(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  ts: z.number(),
  resolved: z.optional(z.boolean()),
  status: z.optional(commentStatusEnum),
  parentId: z.optional(z.string()),
  author: z.optional(z.string()),
  meta: z.optional(commentMeta),
});

const textOp = z.object({
  ...base,
  tool: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  fontSize: z.number(),
});

const selectionRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const selectionOp = z.object({
  ...base,
  tool: z.literal('selection'),
  text: z.string(),
  rects: z.array(selectionRect),
  comment: z.optional(z.string()),
  ts: z.number(),
  author: z.optional(z.string()),
  status: z.optional(commentStatusEnum),
});

export const drawOpSchema = z.discriminatedUnion('tool', [
  freehandOp,
  rectOp,
  lineOp,
  circleOp,
  commentOp,
  textOp,
  selectionOp,
]);
export const opsArraySchema = z.array(drawOpSchema);
