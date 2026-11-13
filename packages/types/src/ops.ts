import { isUploadId } from '@marklayer/brand/links';
import { z } from 'zod/mini';
import { MAX_DIAGNOSIS_RECENT, MAX_NETWORK_ERRORS, MAX_PAGE_ERROR_TEXT, MAX_PAGE_ERRORS } from './relay';

export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;

export const deviceModeSchema = z.enum(['desktop', 'tablet', 'mobile']);
export type DeviceMode = z.infer<typeof deviceModeSchema>;
export const DEVICE_MODES = deviceModeSchema.options;
/** What an op with no `device` was drawn on: the field arrived after desktop-only rooms did. */
export const DEFAULT_DEVICE: DeviceMode = 'desktop';

/**
 * Viewport (in CSS pixels) of the window/iframe the annotation was drawn on.
 * Used at render time to scale or reproject ops when the current viewport
 * differs from the one the user drew on (different screen size, device mode,
 * iframe width). Optional for backwards compat with pre-anchor ops.
 */
export const captureViewportSchema = z.object({ width: z.number(), height: z.number() });
export type CaptureViewport = z.infer<typeof captureViewportSchema>;

export const selectionRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type SelectionRect = z.infer<typeof selectionRectSchema>;

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

export const DEFAULT_LAYER_ID = 'default';

const baseOp = {
  layerId: z.optional(z.string().check(z.minLength(1))),
  id: z.string(),
  color: z.string(),
  lineWidth: z.number(),
  ...authored,
  /** Viewport size this annotation was drawn on */
  device: z.optional(deviceModeSchema),
  captureViewport: z.optional(captureViewportSchema),
};

/**
 * What an agent gets per picked element beyond the selector, mirroring Cursor's
 * Design Mode payload. Every field is optional so rooms written before they
 * existed still parse.
 */
export const elementDetailsSchema = z.object({
  id: z.optional(z.string()),
  classes: z.optional(z.array(z.string())),
  attributes: z.optional(z.record(z.string(), z.string())),
  /** Visible text, whitespace-collapsed and capped at 200 chars by the capturer. */
  visibleText: z.optional(z.string()),
  /** color, background-color, font-size, font-family, display, position (kebab-case keys). */
  styles: z.optional(z.record(z.string(), z.string())),
  component: z.optional(
    z.object({
      framework: z.enum(['React', 'Vue', 'Svelte']),
      /** Nearest component first. */
      chain: z.array(z.string()),
      source: z.optional(
        z.object({ fileName: z.string(), lineNumber: z.number(), columnNumber: z.optional(z.number()) }),
      ),
    }),
  ),
});
export type ElementDetails = z.infer<typeof elementDetailsSchema>;

/**
 * Element context attached to an annotation so an MCP-connected agent can locate
 * what was being referenced without round-tripping back to the page. `markdown`
 * is the same `formatForAI()` payload the Inspect tool uses, so all annotation
 * tools converge on a single agent-readable shape.
 */
export const targetElementSchema = z.object({
  ...elementDetailsSchema.shape,
  selector: z.string(),
  tag: z.string(),
  markdown: z.string(),
  rect: z.optional(selectionRectSchema),
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

/** One uncaught error, rejection or `console.error` the page had logged when the comment was left. */
export const pageErrorSchema = z.object({
  message: z.string().check(z.maxLength(MAX_PAGE_ERROR_TEXT)),
  source: z.optional(z.string().check(z.maxLength(MAX_PAGE_ERROR_TEXT))),
  line: z.optional(z.int()),
  at: z.number(),
});
export type PageError = z.infer<typeof pageErrorSchema>;

/** A failed request observed in the page, with query/hash removed before it leaves that page. */
export const networkErrorSchema = z.object({
  method: z.string().check(z.maxLength(16)),
  url: z.string().check(z.maxLength(MAX_PAGE_ERROR_TEXT)),
  status: z.optional(z.int()),
  error: z.optional(z.string().check(z.maxLength(80))),
  durationMs: z.number(),
  at: z.number(),
});
export type NetworkError = z.infer<typeof networkErrorSchema>;

/** A bounded, shareable snapshot of the page around one annotation. */
export const diagnosisSchema = z.object({
  capturedAt: z.number(),
  source: z.enum(['live-page', 'stored-annotation']),
  target: z.optional(targetElementSchema),
  hierarchy: z.optional(z.object({ iframeDepth: z.number(), shadowDepth: z.number() })),
  hitTest: z.optional(
    z.object({
      covered: z.boolean(),
      hit: z.optional(z.object({ selector: z.string(), tag: z.string() })),
      chain: z
        .array(
          z.object({
            selector: z.string(),
            tag: z.string(),
            pointerEvents: z.string(),
            position: z.string(),
            zIndex: z.string(),
            opacity: z.string(),
            visibility: z.string(),
          }),
        )
        .check(z.maxLength(8)),
    }),
  ),
  pageErrorCount: z.int(),
  pageErrors: z.array(pageErrorSchema).check(z.maxLength(MAX_DIAGNOSIS_RECENT)),
  networkFailureCount: z.int(),
  networkFailures: z.array(networkErrorSchema).check(z.maxLength(MAX_DIAGNOSIS_RECENT)),
  viewport: z.optional(
    z.object({
      devicePixelRatio: z.optional(z.number()),
      scale: z.optional(z.number()),
      scrollX: z.optional(z.number()),
      scrollY: z.optional(z.number()),
    }),
  ),
  reproductionSteps: z.array(z.string().check(z.maxLength(200))).check(z.maxLength(6)),
  partial: z.boolean(),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;

/** The handful of entities that actually turn up in copy. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Collapse runs of whitespace to a single space, trim, and decode entities.
 *
 * The decode matters for the same reason `FINGERPRINT_LEN` is shared: a browser
 * hands the client `Terms & Conditions`, while the server reads the raw HTML and
 * would keep `Terms &amp; Conditions`. Two spellings of one label means the text
 * fallback never resolves the element it was captured from — and an agent gets
 * asked to review `&amp;`.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Length of `text` above. Shared because both ends must agree: the client
 * captures the fingerprint and the server builds one for the same element in
 * `page-outline.ts`, and a server fingerprint cut to a different length simply
 * stops resolving.
 */
export const FINGERPRINT_LEN = 50;

/**
 * Anchor for an annotation drawn on a document we render ourselves — a PDF, or
 * an image — as a fraction of the box of one of its pages. Such a document has
 * no stable element to bind to: pdf.js rebuilds the text layer's spans at every
 * zoom level, so both halves of `targetElement` — the selector and the
 * element-local offset — go stale. The page number plus a 0..1 fraction
 * survives all of it, and reprojects with a multiply. An image is simply a
 * one-page document. Absent on ops drawn over ordinary web pages.
 */
export const pageAnchorSchema = z.object({
  /** 1-based, matching how PDF pages are numbered everywhere a user sees them. */
  page: z.number(),
  x: z.number(),
  y: z.number(),
});

export type PageAnchor = z.infer<typeof pageAnchorSchema>;

/**
 * Mixed into every op that can be bound to a page element, so adding an
 * anchorable tool is one spread rather than a remembered line. Optional for
 * backwards compat with ops recorded before anchoring existed. `pdf` is the
 * same idea for a document we paginate ourselves, and the two are mutually
 * exclusive in practice. The key predates images being one of those documents
 * and is kept as it is: it is on every mark already stored on a PDF.
 */
const anchorable = {
  target: z.optional(targetElementSchema),
  pdf: z.optional(pageAnchorSchema),
  /** Runtime diagnosis is a separate op field so the shared comment metadata stays backwards compatible. */
  diagnosis: z.optional(diagnosisSchema),
};

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

/** Every status plus `all`, for the surfaces that filter on one. */
export const STATUS_FILTERS = [...commentStatusSchema.options, 'all'] as const;

/**
 * Triage priority for any annotation that carries a comment (comment pins, area
 * notes, selection notes, element-inspector handoffs). Absent = no priority set.
 * Ordered low → urgent; the renderer maps each level to a color + signal icon.
 */
export const COMMENT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const commentPrioritySchema = z.enum(COMMENT_PRIORITIES);
export type CommentPriority = z.infer<typeof commentPrioritySchema>;

export const commentMetaSchema = z.object({
  url: z.optional(z.string()),
  viewport: z.optional(captureViewportSchema),
  browser: z.optional(z.string()),
  os: z.optional(z.string()),
  errors: z.optional(z.array(pageErrorSchema).check(z.maxLength(MAX_PAGE_ERRORS))),
  networkErrors: z.optional(z.array(networkErrorSchema).check(z.maxLength(MAX_NETWORK_ERRORS))),
});
export type CommentMeta = z.infer<typeof commentMetaSchema>;

/**
 * One person named inside a comment body. Both halves travel because they answer
 * different questions: `id` is the stable client id, so a mention still points at
 * the right person after a rename and can be matched against the reader's own id
 * to decide "this one is for you"; `name` is the snapshot the text was written
 * with, which is what lets a renderer find `@Name` in the prose and what shows
 * when that person is nowhere in the room. Same split as `author`/`authorId`.
 */
export const mentionSchema = z.object({ id: z.string(), name: z.string() });
export type Mention = z.infer<typeof mentionSchema>;

/** People named in this annotation's body. Absent = nobody was tagged. */
const mentioned = {
  mentions: z.optional(z.array(mentionSchema)),
};

/** One person's emoji on a thread entry. The emoji is the grapheme itself, not a shortcode, so a renderer never needs the table. */
export const reactionSchema = z.object({
  emoji: z.string().check(z.minLength(1), z.maxLength(16)),
  ...mentionSchema.shape,
});
export type Reaction = z.infer<typeof reactionSchema>;

/** Enough for a room, not a stadium: the whole list travels in every patch. */
export const MAX_REACTIONS = 200;

/** Emoji reactions on this annotation or reply. Absent = none. */
const reactable = {
  reactions: z.optional(z.array(reactionSchema).check(z.maxLength(MAX_REACTIONS))),
};

/**
 * Toggle `by`'s reaction with `emoji`: off if they already left that one, on
 * otherwise. Pure, so the same call runs in both apps and the result is what
 * ships in the `update_op` patch.
 */
export function toggleReaction({
  reactions = [],
  emoji,
  by,
}: {
  reactions?: Reaction[];
  emoji: string;
  by: Mention;
}): Reaction[] {
  const rest = reactions.filter((r) => !(r.emoji === emoji && r.id === by.id));
  return rest.length < reactions.length ? rest : [...reactions, { emoji, ...by }];
}

/** Reactions grouped per emoji, in first-seen order, for the pill row under a comment. */
export function groupReactions(reactions: Reaction[] | undefined): { emoji: string; by: Mention[] }[] {
  const groups = new Map<string, Mention[]>();
  for (const { emoji, id, name } of reactions ?? []) {
    const list = groups.get(emoji) ?? [];
    list.push({ id, name });
    groups.set(emoji, list);
  }
  return [...groups].map(([emoji, by]) => ({ emoji, by }));
}

/** A handful of screenshots makes the point; more than that belongs in a doc, not a reply. */
export const MAX_ATTACHMENTS = 4;

/**
 * Upload ids (see `isUploadId`/`uploadPath`) of images attached to a comment or reply.
 * Capped here, not only in the picker: this is what the Durable Object validates every op against.
 */
const attachable = {
  attachments: z.optional(z.array(z.string().check(z.refine(isUploadId))).check(z.maxLength(MAX_ATTACHMENTS))),
};

/** A run of comment text, either plain or one resolved `@mention`. */
export interface MentionSegment {
  text: string;
  mention?: Mention;
}

/**
 * Split a comment body into plain runs and `@mention` tokens.
 *
 * Driven by the op's own `mentions` list rather than by a regex over the text,
 * because display names contain spaces: `@Speedy Axolotl` is one tag, and no
 * pattern can tell that from `@Speedy` followed by a word. Candidates are tried
 * longest-first for the same reason. A mention whose name no longer appears in
 * the text (someone edited around it) simply renders as prose — it stays on the
 * op, so notification and filtering still see it.
 */
export function mentionSegments({ text, mentions }: { text: string; mentions?: Mention[] }): MentionSegment[] {
  if (!mentions?.length || !text.includes('@')) return [{ text }];
  // Names lower-cased once, longest first: this runs per keystroke in the
  // composer, so the comparison key is not rebuilt at every `@` position.
  const byLength = mentions
    .filter((mention) => mention.name)
    .map((mention) => ({ mention, lower: mention.name.toLowerCase() }))
    .sort((a, b) => b.lower.length - a.lower.length);
  const lower = text.toLowerCase();
  const segments: MentionSegment[] = [];
  let plainFrom = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '@') {
      i += 1;
      continue;
    }
    const hit = byLength.find((candidate) => lower.startsWith(candidate.lower, i + 1))?.mention;
    if (!hit) {
      i += 1;
      continue;
    }
    if (i > plainFrom) segments.push({ text: text.slice(plainFrom, i) });
    const end = i + 1 + hit.name.length;
    segments.push({ text: text.slice(i, end), mention: hit });
    i = end;
    plainFrom = end;
  }

  if (plainFrom < text.length) segments.push({ text: text.slice(plainFrom) });
  return segments;
}

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
  ...mentioned,
  ...reactable,
  ...attachable,
  /**
   * Upload id of a recorded voice note. Its transcript is `text`, so an agent
   * reading the comment loses nothing by never opening this. A field of its own
   * rather than an `attachments` entry because an id carries no type, and the
   * thread has to know to draw a player and not a thumbnail.
   */
  voice: z.optional(z.string().check(z.refine(isUploadId))),
  /** Upload id of a recorded camera or screen clip. Its narration, if it had any, is transcribed into `text` like `voice`'s. */
  video: z.optional(z.string().check(z.refine(isUploadId))),
  tool: z.literal('comment'),
  num: z.number(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  ts: z.number(),
  resolved: z.optional(z.boolean()),
  parentId: z.optional(z.string()),
  meta: z.optional(commentMetaSchema),
  /** Snapshot of nearby annotations in the author's active layer at capture time. */
  visualContext: z.optional(
    z.object({
      region: selectionRectSchema,
      layerId: z.string().check(z.minLength(1), z.maxLength(80)),
      annotations: z
        .array(
          z.object({
            id: z.string().check(z.minLength(1), z.maxLength(128)),
            kind: z.enum([
              'comment',
              'area',
              'selection',
              'inspect',
              'pen',
              'highlight',
              'rectangle',
              'line',
              'circle',
              'text',
            ]),
            text: z.string().check(z.maxLength(500)),
            bounds: z.optional(selectionRectSchema),
          }),
        )
        .check(z.maxLength(25)),
      truncated: z.boolean(),
      /** Some positions could not be resolved against the visible document. */
      incomplete: z.optional(z.boolean()),
    }),
  ),
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

export const selectionOpSchema = z.object({
  ...baseOp,
  ...anchorable,
  ...triageable,
  ...mentioned,
  ...reactable,
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
  ...mentioned,
  ...reactable,
  ...attachable,
  tool: z.literal('area'),
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  comment: z.optional(z.string()),
  ts: z.number(),
});
export type AreaOp = z.infer<typeof areaOpSchema>;

export const MAX_STYLE_EDITS = 40;
export const MAX_STYLE_PROPERTY = 64;
export const MAX_STYLE_VALUE = 200;

/** One CSS property the reviewer changed live on the element: computed value before, what they typed after. */
export const styleEditSchema = z.object({
  property: z.string().check(z.minLength(1), z.maxLength(MAX_STYLE_PROPERTY)),
  from: z.string().check(z.maxLength(MAX_STYLE_VALUE)),
  to: z.string().check(z.maxLength(MAX_STYLE_VALUE)),
});
export type StyleEdit = z.infer<typeof styleEditSchema>;

/**
 * Element-inspector handoff. Captures the selector, the element rect, and the full
 * markdown snapshot at the moment of inspection so an MCP-connected agent has
 * everything it needs to act without rehydrating the page.
 */
export const inspectOpSchema = z.object({
  ...baseOp,
  ...triageable,
  ...mentioned,
  ...reactable,
  tool: z.literal('inspect'),
  selector: z.string(),
  tag: z.string(),
  comment: z.optional(z.string()),
  markdown: z.string(),
  rect: selectionRectSchema,
  /** Optional forever: rooms written before CSS editing existed carry no such key. */
  styleEdits: z.optional(z.array(styleEditSchema).check(z.maxLength(MAX_STYLE_EDITS))),
  /** Nested, not spread like `targetElementSchema` does: its `id` is the element's and would collide with the op's. */
  details: z.optional(elementDetailsSchema),
  /** Runtime diagnosis hangs off the annotation it explains, same as on a comment. */
  diagnosis: z.optional(diagnosisSchema),
  ts: z.number(),
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

/**
 * The room's intro video: a recorded walkthrough pinned above the thread list,
 * so a reviewer hears the ask before reading the page. Every intro op is one
 * version and the newest is the one shown; re-recording appends, it never edits.
 * Placed nowhere on the page, so it carries no coordinates and no anchor.
 */
export const introOpSchema = z.object({
  ...baseOp,
  tool: z.literal('intro'),
  video: z.string().check(z.refine(isUploadId)),
  title: z.optional(z.string().check(z.maxLength(120))),
  ts: z.number(),
});
export type IntroOp = z.infer<typeof introOpSchema>;
/** Bounds on a poll. Validated by the Durable Object, so a crafted op cannot carry a 500-option ballot. */
export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 6;
export const MAX_QUESTION_TEXT = 300;
export const MAX_STEP_TEXT = 300;
export const MAX_NEXT_STEPS = 20;

/** Stamped by an agent on its own work, so `isAgentAuthored` answers for a poll or a step as it does for a comment. */
const agentStamped = { assignedAgent: z.optional(z.string()) };

/**
 * A structured question put to the room — a poll. Like guides it has no place on
 * the page: `color`/`lineWidth` come from baseOp and nothing draws with them.
 */
export const questionOpSchema = z.object({
  ...baseOp,
  tool: z.literal('question'),
  prompt: z.string().check(z.minLength(1), z.maxLength(MAX_QUESTION_TEXT)),
  options: z
    .array(z.string().check(z.minLength(1), z.maxLength(MAX_QUESTION_TEXT)))
    .check(z.minLength(MIN_QUESTION_OPTIONS), z.maxLength(MAX_QUESTION_OPTIONS)),
  ts: z.number(),
  ...agentStamped,
});
export type QuestionOp = z.infer<typeof questionOpSchema>;

/**
 * One ballot, an op of its own rather than a map on the question: two people
 * voting at once would each patch the whole map and the later patch would erase
 * the earlier vote. `voter` is the stable client id; the latest ballot per voter counts.
 */
export const voteOpSchema = z.object({
  ...baseOp,
  tool: z.literal('vote'),
  questionId: z.string(),
  option: z.int().check(z.gte(0), z.lt(MAX_QUESTION_OPTIONS)),
  voter: z.string().check(z.minLength(1)),
  ts: z.number(),
});
export type VoteOp = z.infer<typeof voteOpSchema>;

/**
 * One item of the agent's next-steps checklist, one op per step so ticking one
 * off is a patch to that step alone. `annotationIds` are the threads it answers.
 */
export const stepOpSchema = z.object({
  ...baseOp,
  tool: z.literal('step'),
  text: z.string().check(z.minLength(1), z.maxLength(MAX_STEP_TEXT)),
  order: z.int(),
  annotationIds: z.optional(z.array(z.string()).check(z.maxLength(MAX_NEXT_STEPS))),
  done: z.optional(z.boolean()),
  /** Display name of whoever ticked it, agent or person. */
  doneBy: z.optional(z.nullable(z.string())),
  ts: z.number(),
  ...agentStamped,
});
export type StepOp = z.infer<typeof stepOpSchema>;

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
  introOpSchema,
  questionOpSchema,
  voteOpSchema,
  stepOpSchema,
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

type OpTool = DrawOp['tool'];

/** Each op family is one list: its type and its predicate both derive from it, so neither can miss a tool. */
const isIn = (tools: readonly OpTool[], tool: OpTool): boolean => tools.includes(tool);

/** Ops that are room state rather than marks: nothing is drawn for them and they never move. */
const REVIEW_TOOLS = ['question', 'vote', 'step'] as const satisfies readonly OpTool[];
export type ReviewOp = Extract<DrawOp, { tool: (typeof REVIEW_TOOLS)[number] }>;
export const isReviewOp = (op: DrawOp): op is ReviewOp => isIn(REVIEW_TOOLS, op.tool);

export interface Ballot {
  option: number;
  name: string | null;
  /** The vote op a revote patches. */
  opId: string;
}

export interface QuestionTally {
  question: QuestionOp;
  /** Per option, in the question's order. */
  counts: number[];
  total: number;
  /** Each voter's current ballot, keyed by `voter`. */
  ballots: Map<string, Ballot>;
}

/**
 * Count a poll. The latest ballot per voter wins, so a revote moves a vote
 * rather than adding one; a ballot for an option the question does not have is
 * ignored. Shared because the viewer and both agent transports must agree.
 */
export function tallyQuestion({ question, ops }: { question: QuestionOp; ops: readonly DrawOp[] }): QuestionTally {
  const latest = new Map<string, VoteOp>();
  for (const op of ops) {
    if (op.tool !== 'vote' || op.questionId !== question.id) continue;
    if (op.option >= question.options.length) continue;
    const seen = latest.get(op.voter);
    if (!seen || op.ts >= seen.ts) latest.set(op.voter, op);
  }
  const counts = question.options.map(() => 0);
  const ballots = new Map<string, Ballot>();
  for (const [voter, vote] of latest) {
    counts[vote.option] = (counts[vote.option] ?? 0) + 1;
    ballots.set(voter, { option: vote.option, name: vote.author ?? null, opId: vote.id });
  }
  return { question, counts, total: latest.size, ballots };
}

/** The checklist in the order the agent wrote it. */
export const orderedSteps = (ops: readonly DrawOp[]): StepOp[] =>
  ops.filter((op): op is StepOp => op.tool === 'step').sort((a, b) => a.order - b.order);

/**
 * Ops that bind to a page element (comment/selection/area — reprojected whole)
 * vs. canvas marks (pen/line/circle/etc.) that stay in document coordinates
 * because anchoring just their origin would tear the shape off its own
 * geometry on reflow — a stroke is a gesture, not a region. Checked on `tool`
 * rather than `'target' in op` since `target` is optional and a freshly drawn
 * op has no such key yet.
 */
const ANCHORABLE_TOOLS = ['comment', 'selection', 'area'] as const satisfies readonly OpTool[];
export type AnchorableOp = Extract<DrawOp, { tool: (typeof ANCHORABLE_TOOLS)[number] }>;
export const isAnchorableOp = (op: DrawOp): op is AnchorableOp => isIn(ANCHORABLE_TOOLS, op.tool);

export const opsArraySchema = z.array(drawOpSchema);

/**
 * Stored ops, read per op rather than all-or-nothing: one op from a newer client
 * (a tool this build has never seen) must not blank the whole room. Writes stay
 * strict through `opsArraySchema`.
 */
export const parseOps = (raw: unknown): DrawOp[] =>
  Array.isArray(raw)
    ? raw.flatMap((o) => {
        const parsed = drawOpSchema.safeParse(o);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/**
 * `op` shifted by a viewport delta, or null for the ops that cannot meaningfully
 * be moved as a copy: a comment owns a thread, a selection owns a text range, an
 * inspect owns an element handoff, a guide owns an axis, and an eraser stroke is a
 * subtraction from the strokes beneath it.
 *
 * Which fields of an op are coordinates is op-schema knowledge, so it lives here
 * rather than in a host — the `never` guard then makes a new tool declare how it
 * translates instead of compiling and silently not moving.
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
    case 'intro':
    case 'question':
    case 'vote':
    case 'step':
      return null;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * The ops that own a comment thread, and so carry triage state. A list rather than a
 * union so a surface enumerating annotation kinds derives from it and a new kind
 * reaches every one of them, or fails to compile.
 */
export const ANNOTATION_TOOLS = ['comment', 'selection', 'inspect', 'area'] as const satisfies readonly OpTool[];
export type AnnotationOp = Extract<DrawOp, { tool: (typeof ANNOTATION_TOOLS)[number] }>;

/** True for a reply too: a reply is a comment op. `isRootAnnotation` is the one that means a thread. */
export function isAnnotationOp(op: DrawOp): op is AnnotationOp {
  return isIn(ANNOTATION_TOOLS, op.tool);
}

/** An annotation in its own right. Replies belong to their parent's thread, so they are not themselves one. */
export const isRootAnnotation = (op: DrawOp): op is AnnotationOp =>
  isAnnotationOp(op) && !(op.tool === 'comment' && !!op.parentId);

/** Every annotation kind owns a thread, since replies are indexed by `parentId` whatever the parent is. A reply does not. */
export const canReply = isRootAnnotation;

/** Replies are numbered off the root comments only, or one would take a number a real comment already shows. */
export const nextCommentNum = (ops: readonly DrawOp[]): number =>
  ops.filter((op) => op.tool === 'comment' && !op.parentId).length + 1;

/** The room as threads: root annotations in op order, and each one's replies keyed by parent id. */
export function indexOps(ops: readonly DrawOp[]): { roots: AnnotationOp[]; replies: Map<string, CommentOp[]> } {
  const roots: AnnotationOp[] = [];
  const replies = new Map<string, CommentOp[]>();
  for (const op of ops) {
    if (op.tool === 'comment' && op.parentId) {
      const thread = replies.get(op.parentId);
      if (thread) thread.push(op);
      else replies.set(op.parentId, [op]);
    } else if (isRootAnnotation(op)) roots.push(op);
  }
  return { roots, replies };
}

/**
 * Where this annotation sits: its top-left in document px.
 *
 * Distinct from the element anchor in `target`, which re-resolves against layout.
 * This is the human answer — where the panel scrolls to, where the board sorts
 * by, where a reply pin lands.
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
 * Nothing left to do on this thread, whichever way it ended. Wider than `isSettled`:
 * dismissed is no fix at all, so it stays out of `resolved` and the agent counts, but
 * to a person it is as finished as the others: dimmed, and offered Reopen, never Resolve.
 */
export function isClosed(status: CommentStatus): boolean {
  return isSettled(status) || status === 'dismissed';
}

const TASK_HEADING = '## Task';

/**
 * A reviewer's instruction above an element snapshot, in that order because an agent
 * reading the comment needs what was asked before the context. `bodyHeading` is what
 * `parse` splits on: the snapshot's own first heading.
 */
export const taskNote = {
  build: ({ task, body }: { task?: string; body: string }): string =>
    task ? `${TASK_HEADING}\n\n${task}\n\n${body}` : body,

  parse({ text, bodyHeading }: { text: string; bodyHeading: string }): { task: string | null; body: string } {
    const split = text.indexOf(bodyHeading);
    if (!text.startsWith(TASK_HEADING) || split <= 0) return { task: null, body: text };
    return { task: text.slice(TASK_HEADING.length, split).trim() || null, body: text.slice(split) };
  },
};

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
