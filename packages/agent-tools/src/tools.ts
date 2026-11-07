import { parseFetchableUrl } from '@marklayer/types/net';
import {
  commentPrioritySchema,
  MAX_NEXT_STEPS,
  MAX_QUESTION_OPTIONS,
  MAX_QUESTION_TEXT,
  MAX_STEP_TEXT,
  MIN_QUESTION_OPTIONS,
  STATUS_FILTERS,
  selectionRectSchema,
} from '@marklayer/types/ops';
import { z } from 'zod/mini';

/**
 * The agent tool contract: one row per tool, and every derived list reads the table.
 * Limits live once, on the zod input; the JSON Schema a client is shown comes from it.
 */

/** The JSON Schema a client is shown. Structurally the SDK's `Tool`, without depending on one. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const StatusFilter = z.enum(STATUS_FILTERS);

/** The annotation id every per-annotation tool takes, spread the way `targetParts` below is. */
const idPart = { id: z.string().check(z.minLength(1)) };

export const ConnectInput = z.object({
  room: z
    .string()
    .check(z.minLength(1), z.describe('Room URL like https://marklayer.app/s/abc123 or a bare room id like abc123.')),
  password: z.optional(
    z.string().check(z.describe('Only for a password-protected room: the password its owner shared.')),
  ),
});
export const ListInput = z.object({ status: z.optional(StatusFilter) });
export const IdInput = z.object({ ...idPart });

/**
 * How long one `watch` blocks by default.
 *
 * Shared so the two transports cannot disagree about how long "watching" lasts.
 * The wait itself is free — the Durable Object parks a promise and wakes on the
 * next op — so a short window only buys an agent that stops looking sooner.
 *
 * The ceiling is the client's, not the edge's. Measured: a 182s hold returned
 * 200 through Cloudflare, because the Streamable HTTP transport sends SSE
 * keepalive comments. But a keepalive is not a progress notification, so it
 * does not reset an MCP client's per-request timer — and that timer defaults to
 * 60s (`DEFAULT_REQUEST_TIMEOUT_MSEC`). Anything at or above 60 races a timeout
 * the caller sees as a broken tool, which is worse than looking away sooner.
 */
export const WATCH_DEFAULT_SECONDS = 50;
/** The longest one watch may ask for. An agent's presence in a room has to outlive it. */
export const WATCH_MAX_SECONDS = 600;
/** After the first event, how long a watch keeps gathering before it answers. */
export const WATCH_BATCH_MS = 750;

export const WatchInput = z.object({
  timeoutSeconds: z.optional(
    z
      .number()
      .check(
        z.int(),
        z.gte(1),
        z.lte(WATCH_MAX_SECONDS),
        z.describe(
          `How long to block before returning empty. Defaults to ${WATCH_DEFAULT_SECONDS}, which fits inside the 60s ` +
            'request timeout most clients use. Raise it only if you know yours allows a longer tool call.',
        ),
      ),
  ),
  batchMs: z.optional(
    z
      .number()
      .check(
        z.int(),
        z.gte(0),
        z.lte(10000),
        z.describe(
          `After the first new annotation arrives, wait this long for more before returning. Default ${WATCH_BATCH_MS}.`,
        ),
      ),
  ),
});
export const ResolveInput = z.object({
  ...idPart,
  summary: z.optional(z.string().check(z.describe('Short description of what changed, posted as a reply.'))),
});
export const DismissInput = z.object({
  ...idPart,
  reason: z.string().check(z.minLength(1), z.describe('Why you cannot act on this annotation.')),
});
export const ReplyInput = z.object({ ...idPart, text: z.string().check(z.minLength(1)) });

/**
 * Shared by every tool that lets an agent anchor a new annotation to an
 * element: `selector`/`tag`/`markdown` must arrive all three or none, never a
 * partial triple that would fail `targetElementSchema`'s required fields at
 * the wire boundary. A schema-level refine, so it is rejected before the
 * handler ever runs — the same way every other tool's input is validated.
 */
const targetTripleCheck = z.refine<{ selector?: string; tag?: string; markdown?: string }>(
  ({ selector, tag, markdown }) => {
    const given = [selector, tag, markdown].filter((v) => v !== undefined).length;
    return given === 0 || given === 3;
  },
  'selector, tag and markdown must be given together, or not at all',
);

/**
 * The element-anchor triple, spread into every schema that carries `targetTripleCheck`.
 * Never empty: an empty string counts as given here and as absent in `targetFromParts`,
 * which is an unanchored pin at 0,0 with no error.
 */
const targetParts = ({ selector, tag }: { selector: string; tag: string }) => ({
  selector: z.optional(z.string().check(z.minLength(1), z.describe(selector))),
  tag: z.optional(z.string().check(z.minLength(1), z.describe(tag))),
  markdown: z.optional(
    z.string().check(z.minLength(1), z.describe('Short markdown snapshot of the element, for the human to see.')),
  ),
});

const priorityPart = {
  priority: z.optional(commentPrioritySchema.check(z.describe('Triage priority, if this warrants one.'))),
};

export const CreateInput = z
  .object({
    text: z.string().check(z.minLength(1), z.describe('The feedback itself.')),
    x: z.optional(z.number().check(z.describe('Document-space X in CSS pixels.'))),
    y: z.optional(z.number().check(z.describe('Document-space Y in CSS pixels.'))),
    ...priorityPart,
    ...targetParts({
      selector: 'CSS selector of the element this is about.',
      tag: 'Tag name of that element, e.g. "button".',
    }),
  })
  .check(targetTripleCheck)
  .check(
    z.refine(
      ({ x, y, selector }) => selector !== undefined || (x !== undefined && y !== undefined),
      'give x and y, or selector + tag + markdown to pin to an element',
    ),
  );

/**
 * `rects` mirrors the human selection tool's own shape — one box per line the
 * proposed edit spans — rather than a single bounding box, so a multi-line
 * selection renders as a multi-line highlight instead of one box swallowing
 * the whole paragraph between its first and last line.
 *
 * `suggestion` is trimmed here so what passes is what `normalizeSuggestion` keeps:
 * the refine below compares trimmed text, so a whitespace-only value used to get
 * through and be stored raw.
 */
export const SuggestInput = z
  .object({
    text: z.string().check(z.minLength(1), z.describe('The exact text on the page being replaced.')),
    suggestion: z.string().check(z.trim(), z.minLength(1), z.describe('The exact replacement text.')),
    rects: z
      .array(selectionRectSchema)
      .check(
        z.minLength(1),
        z.describe('Document-pixel bounding box(es) of `text` on the page — one per line it spans.'),
      ),
    comment: z.optional(z.string().check(z.describe('Optional note explaining the fix, if it is not self-evident.'))),
    ...priorityPart,
    ...targetParts({
      selector: 'CSS selector of the element containing this text.',
      tag: 'Tag name of that element, e.g. "p".',
    }),
  })
  .check(
    targetTripleCheck,
    z.refine(
      ({ text, suggestion }) => text.trim() !== suggestion.trim(),
      'suggestion must differ from text — there is nothing to propose otherwise',
    ),
  );

const MAX_PREVIEW_TEXT = 200;
const MAX_PREVIEW_NOTE = 2000;
/** More than a handful of polls on one preview is a survey, not a review. */
export const MAX_PREVIEW_QUESTIONS = 5;

const shortText = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));

export const QuestionInput = z.object({
  prompt: shortText(MAX_QUESTION_TEXT),
  options: z
    .array(shortText(MAX_QUESTION_TEXT))
    .check(z.minLength(MIN_QUESTION_OPTIONS), z.maxLength(MAX_QUESTION_OPTIONS)),
});
export type QuestionRequest = z.infer<typeof QuestionInput>;

/**
 * A page that can be named as a preview: `blocked` passes because this has only ever
 * judged the scheme, and the share API takes the same schema. A private host fails
 * later, at the proxy, instead of here.
 */
function isPreviewUrl(value: string): boolean {
  const parsed = parseFetchableUrl(value);
  return parsed.ok || parsed.reason === 'blocked';
}

export const SharePreviewInput = z.object({
  url: z
    .string()
    .check(
      z.refine(isPreviewUrl, 'url must be an absolute http(s) URL'),
      z.describe('Absolute http(s) URL of the page to review.'),
    ),
  title: shortText(MAX_PREVIEW_TEXT).check(z.describe('What this is, in a few words — shown to reviewers.')),
  repo: z.optional(
    shortText(MAX_PREVIEW_TEXT).check(z.describe('Repository, e.g. "acme/web". With `branch`, chains versions.')),
  ),
  branch: z.optional(shortText(MAX_PREVIEW_TEXT).check(z.describe('Branch the preview was built from.'))),
  sha: z.optional(
    shortText(MAX_PREVIEW_TEXT).check(z.describe('Commit the preview was built from; shown beside the version.')),
  ),
  note: z.optional(
    shortText(MAX_PREVIEW_NOTE).check(z.describe('What changed and what to look at, for the reviewers.')),
  ),
  questions: z.optional(
    z
      .array(QuestionInput)
      .check(
        z.maxLength(MAX_PREVIEW_QUESTIONS),
        z.describe('Polls to open the room with — a decision you want the reviewers to make.'),
      ),
  ),
  previous: z.optional(
    shortText(MAX_PREVIEW_TEXT).check(
      z.describe(
        'The room this is a new version of, as a link or id. Defaults to the room you are connected to. ' +
          'Linked only when that room has the same repo and branch.',
      ),
    ),
  ),
});
export type PreviewRequest = z.infer<typeof SharePreviewInput>;

export const SetStepsInput = z.object({
  steps: z
    .array(
      z.object({
        text: shortText(MAX_STEP_TEXT).check(
          z.describe('The step, as an imperative: "Rename the CTA to Start trial".'),
        ),
        annotationIds: z.optional(
          z
            .array(z.string().check(z.minLength(1)))
            .check(z.maxLength(MAX_NEXT_STEPS), z.describe('Ids of the annotations this step addresses.')),
        ),
      }),
    )
    .check(z.minLength(1), z.maxLength(MAX_NEXT_STEPS)),
});
export type StepRequest = z.infer<typeof SetStepsInput>['steps'][number];

export const CompleteStepInput = z.object({
  id: z.string().check(z.minLength(1), z.describe('Step id, from marklayer_set_next_steps or marklayer_get_feedback.')),
  done: z.optional(z.boolean().check(z.describe('Defaults to true.'))),
});

const NoInput = z.object({});

export type ToolTransport = 'http' | 'stdio';
const EVERY_TRANSPORT = ['http', 'stdio'] as const satisfies readonly ToolTransport[];

interface ToolDef {
  description: string;
  input: z.ZodMiniType;
  /** Waits on or writes to the room, so a dead connection has to fail it rather than hang or no-op. */
  needsLiveRoom: boolean;
  /** False for a tool a server answers before any room is connected. */
  needsRoom: boolean;
  transports: readonly ToolTransport[];
}

const READS_ROOM = { needsLiveRoom: false, needsRoom: true, transports: EVERY_TRANSPORT };
const WORKS_ROOM = { needsLiveRoom: true, needsRoom: true, transports: EVERY_TRANSPORT };

const TOOL_DEFS = {
  marklayer_read_page: {
    ...READS_ROOM,
    description:
      'Read the page this room annotates — its headings, paragraphs, links, buttons and labels, each with the CSS ' +
      'selector and tag that locate it. Call this FIRST when asked to review, audit or improve a page and no ' +
      'annotations exist yet: without it you can only answer feedback someone else left, never find anything ' +
      'yourself. Every entry is already in the shape marklayer_suggest_edit and marklayer_create_annotation take, ' +
      'so pass `selector`, `tag` and `markdown` straight through to anchor a mark to the element you are talking ' +
      'about. If the answer says the page renders client-side, the copy is not in the HTML and you should say so ' +
      'rather than review an empty shell.',
    input: NoInput,
  },
  marklayer_connect_room: {
    // The URL binds the room over HTTP, so this has no meaning there.
    needsLiveRoom: false,
    needsRoom: false,
    transports: ['stdio'],
    description: 'Connect to a MarkLayer room (annotation session) by URL or bare room id. Disconnects any prior room.',
    input: ConnectInput,
  },
  marklayer_room_info: {
    ...READS_ROOM,
    description: 'Get metadata about the connected room: page URL, viewport width, timestamps.',
    input: NoInput,
  },
  marklayer_list_annotations: {
    ...READS_ROOM,
    description:
      'List every annotation in the connected room across all tools (comment, area, selection, inspect). ' +
      'Each entry carries a `kind` discriminator and, where the user marked an element, a `target` block ' +
      'with selector + markdown so you can address the change without reopening the page. ' +
      'Filter by status: open, in_progress, resolved, approved, dismissed, or all (default). `approved` means the person who asked for the change confirmed the fix, so those need nothing from you.',
    input: ListInput,
  },
  marklayer_get_annotation: {
    ...READS_ROOM,
    description:
      'Get full detail for a single annotation of any kind (comment, area, selection, inspect), including ' +
      'its element `target` context and — for comments — the reply thread.',
    input: IdInput,
  },
  marklayer_watch_annotations: {
    ...WORKS_ROOM,
    description:
      'Block until there is work, then return a batch of whatever arrives within a short window. ' +
      'CALL THIS AGAIN IMMEDIATELY EVERY TIME IT RETURNS, including when it returns nothing — an empty result means ' +
      'the window expired, not that the reviewer is done. Nothing pushes work to you: between your calls, a comment ' +
      'someone leaves reaches no one. Keep looping until the person tells you to stop or ends the session. ' +
      'Each event has a `kind`: "new" is an annotation someone just left; "handoff" is one given to you — assigned ' +
      'to you, a reply that @mentions you, or a reply on a thread you already own. A handoff also carries ' +
      '`request`, the reply that asked: read it, it is the instruction, and act on it rather than only ' +
      'acknowledging. Every event carries the full annotation with its `target` element context.',
    input: WatchInput,
  },
  marklayer_acknowledge: {
    ...WORKS_ROOM,
    description:
      'Mark an annotation as in_progress and tag it with this agent so the human sees you are working on it.',
    input: IdInput,
  },
  marklayer_resolve: {
    ...WORKS_ROOM,
    description:
      'Mark an annotation as resolved. Pass a summary describing what was changed — it will be posted as a reply to the thread.',
    input: ResolveInput,
  },
  marklayer_dismiss: {
    ...WORKS_ROOM,
    description: 'Mark an annotation as dismissed when it cannot be acted on. The reason will be visible to the human.',
    input: DismissInput,
  },
  marklayer_reply: {
    ...WORKS_ROOM,
    description: 'Post a reply to an annotation thread without changing its status. Use to ask clarifying questions.',
    input: ReplyInput,
  },
  marklayer_create_annotation: {
    ...WORKS_ROOM,
    description:
      'Leave a new comment annotation yourself — proactive feedback (a bug, a UX issue, an accessibility gap, an ' +
      'idea) rather than only responding to a human’s. For an exact text replacement (a copy or grammar fix), use ' +
      'marklayer_suggest_edit instead — it renders as a diff the human can accept, rather than prose describing one. ' +
      'Use this after you have looked at the page with your own tools (a screenshot, a DOM read) and decided ' +
      'something is worth flagging; call it once per finding so each becomes its own pin the human can triage. x/y ' +
      'are document pixels (not viewport pixels — scroll offset already added in). Pass selector + tag + markdown ' +
      '(straight from marklayer_read_page) to pin to that element: the pin sits on the element and follows it when ' +
      'the page reflows, and x/y become optional (a fallback only). Omit all three for a fixed-point pin at x/y.',
    input: CreateInput,
  },
  marklayer_suggest_edit: {
    ...WORKS_ROOM,
    description:
      'Propose an exact replacement for a piece of text on the page — a copy or grammar fix — as a diff the human ' +
      'can accept, rather than a comment describing the change in prose. `rects` are the on-page bounding boxes of ' +
      '`text`, in document pixels: one per line it spans, so a wrapped sentence highlights as several boxes rather ' +
      'than one box swallowing the whole paragraph between its first and last line. Pass selector + tag + markdown ' +
      'together to anchor it to the containing element so it re-resolves if the page reflows.',
    input: SuggestInput,
  },
  marklayer_share_preview: {
    // Makes a room rather than working one.
    needsLiveRoom: false,
    needsRoom: false,
    transports: EVERY_TRANSPORT,
    description:
      'Open a new review room on a page you built — a preview deploy, a staging URL — and get back the link to hand ' +
      'to a human. Call this when you have something for someone to look at, rather than asking them to open a URL ' +
      'and describe what they see. The page is framed live and reviewers annotate it directly; their feedback then ' +
      'reaches you through the other tools. Pass `repo` + `branch` (and `sha`) when the page comes from a branch: ' +
      'a later preview of the same repo and branch becomes the next version of this one, and reviewers can step ' +
      'between versions. Over stdio this also connects you to the new room. Over HTTP the endpoint stays bound to ' +
      'the room in its URL, so reconnect to the returned `mcpUrl` to work the new room.',
    input: SharePreviewInput,
  },
  marklayer_set_next_steps: {
    ...WORKS_ROOM,
    description:
      'Publish your plan as a short ordered checklist the reviewers see live in the room, distilled from their ' +
      'feedback — one step per change you will make, each naming the annotation ids it answers. Replaces any list ' +
      'you set before. Tick steps off with marklayer_complete_next_step as you finish them, so the humans can watch ' +
      'the work land instead of asking where it is.',
    input: SetStepsInput,
  },
  marklayer_complete_next_step: {
    ...WORKS_ROOM,
    description: 'Tick a step of the checklist off (or back on with done: false). Reviewers see it change live.',
    input: CompleteStepInput,
  },
  marklayer_ask: {
    ...WORKS_ROOM,
    description:
      'Put a multiple-choice question to the room — "Which hero variant?", "Ship with the banner?" — when you need ' +
      'a decision rather than open-ended feedback. Each reviewer gets one vote and may change it. Read the tally ' +
      'with marklayer_get_feedback.',
    input: QuestionInput,
  },
  marklayer_get_feedback: {
    ...READS_ROOM,
    description:
      'Everything the room has told you, in one read: annotation counts by status with the open ones in full, the ' +
      'next-steps checklist and how far along it is, and every poll with its current tally. Use it to decide what ' +
      'to do next; use marklayer_watch_annotations to wait for more.',
    input: NoInput,
  },
} as const satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof TOOL_DEFS;

export const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOL_DEFS, name);

const toolDefs: [string, ToolDef][] = Object.entries(TOOL_DEFS);

/** `input` mode leaves `additionalProperties` unset, and these tools have always refused unknown keys at the top. */
function jsonSchemaOf(input: ToolDef['input']): ToolSpec['inputSchema'] {
  const { properties, required } = z.toJSONSchema(input, { io: 'input' });
  return { type: 'object', additionalProperties: false, properties, ...(required ? { required } : {}) };
}

export const TOOLS: ToolSpec[] = toolDefs.map(([name, { description, input }]) => ({
  name,
  description,
  inputSchema: jsonSchemaOf(input),
}));

/** What a server on this transport advertises. */
export const toolsFor = (transport: ToolTransport): ToolSpec[] => {
  const served = new Set(toolDefs.flatMap(([name, def]) => (def.transports.includes(transport) ? [name] : [])));
  return TOOLS.filter((tool) => served.has(tool.name));
};

/** Tools a dead connection has to fail, rather than leave to hang or no-op. */
export const NEEDS_LIVE_ROOM: ReadonlySet<string> = new Set(
  toolDefs.flatMap(([name, def]) => (def.needsLiveRoom ? [name] : [])),
);

/** Tools that have nothing to answer without a room. */
export const NEEDS_ROOM: ReadonlySet<string> = new Set(
  toolDefs.flatMap(([name, def]) => (def.needsRoom ? [name] : [])),
);

const WORKING_A_ROOM =
  'Each annotation carries a `kind` (comment | area | selection | inspect) and, where available, ' +
  'a `target` block with the element selector + markdown — that is your handle for code changes; ' +
  'do not ask the user to repeat what was clicked. ' +
  'A selection annotation may also carry a `suggestion`: the exact text the reviewer wants in place of its ' +
  '`text`. Apply it verbatim rather than paraphrasing it. ' +
  'A comment (or a reply, from marklayer_get_annotation) may carry `attachments`: fetchable image URLs the ' +
  'reviewer attached — fetch and look at one before acting on a comment that has any, they often show the ' +
  'bug or the intended layout better than the text does. ' +
  'Typical loop: marklayer_list_annotations to backfill anything pending, then marklayer_watch_annotations ' +
  'in a loop. For each one: acknowledge, make the requested code changes, resolve with a summary. ' +
  'Use dismiss when an annotation cannot be acted on, with a reason the human can read. ' +
  'You can also work the other direction: if asked to review, audit, or give feedback on the page (bugs, UX ' +
  'or accessibility issues, ideas), inspect it with your own tools and call marklayer_create_annotation once ' +
  'per finding — do not bundle several into one comment. For an exact copy or grammar fix, use ' +
  'marklayer_suggest_edit instead of a comment, so the human gets a diff to accept rather than prose ' +
  'describing one.';

/** So both transports teach one loop. Connecting is stdio's step alone: a URL binds the room over HTTP. */
export const instructionsFor = (transport: ToolTransport): string =>
  'Bridge between MarkLayer annotations on a webpage and an AI coding agent. ' +
  (transport === 'stdio' ? 'Call marklayer_connect_room first if no MARKLAYER_ROOM was provided at startup. ' : '') +
  WORKING_A_ROOM;
