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

const commentOp = z.object({
  ...base,
  tool: z.literal('comment'),
  num: z.number(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  ts: z.number(),
  resolved: z.optional(z.boolean()),
  parentId: z.optional(z.string()),
  author: z.optional(z.string()),
});

const textOp = z.object({
  ...base,
  tool: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  fontSize: z.number(),
});

export const drawOpSchema = z.union([freehandOp, rectOp, lineOp, circleOp, commentOp, textOp]);
export const opsArraySchema = z.array(drawOpSchema);
