import { type DrawOp, drawOpSchema } from '@marklayer/types';

/**
 * What a share amounts to, in three numbers.
 *
 * This is all the card and the unfurl description say about someone's
 * annotations, deliberately. The geometry used to be painted onto the card, and
 * an OG image is fetched and cached by every chat app, crawler and link
 * previewer that sees the URL — so sharing an internal page once republished
 * whatever was drawn on it into Slack, iMessage and search indexes. A count says
 * there is something to look at without being the thing to look at.
 */
export interface OpTally {
  comments: number;
  drawings: number;
  notes: number;
}

/**
 * Which line of the card's stat row an op counts toward. Exhaustive over the op
 * union on purpose: a tool added to `drawOpSchema` is a type error here rather
 * than an annotation that silently counts as nothing. `eraser` and `guide` are
 * `none` because neither is a thing someone said about the page.
 */
const TOOL_TALLY: Record<DrawOp['tool'], keyof OpTally | 'none'> = {
  comment: 'comments',
  pen: 'drawings',
  highlight: 'drawings',
  rectangle: 'drawings',
  line: 'drawings',
  circle: 'drawings',
  text: 'notes',
  area: 'notes',
  selection: 'notes',
  inspect: 'notes',
  eraser: 'none',
  guide: 'none',
};

const isTallyTool = (tool: string): tool is DrawOp['tool'] => tool in TOOL_TALLY;

/** The op's tool, from the schema when it parses and from the raw row when it does not. */
function toolOf(raw: unknown): string | null {
  const parsed = drawOpSchema.safeParse(raw);
  if (parsed.success) return parsed.data.tool;
  if (raw && typeof raw === 'object' && 'tool' in raw && typeof raw.tool === 'string') return raw.tool;
  return null;
}

/**
 * Count stored ops by kind. Ops that fail the schema are still counted from
 * their tool name — a legacy annotation gets a plainer card, never an empty one.
 */
export function collectTally(stored: unknown[]): OpTally {
  const tally: OpTally = { comments: 0, drawings: 0, notes: 0 };
  for (const raw of stored) {
    const tool = toolOf(raw);
    const bucket = tool && isTallyTool(tool) ? TOOL_TALLY[tool] : 'none';
    if (bucket === 'none') continue;
    // A reply is part of its thread, not a second comment on the page.
    const isReply = !!raw && typeof raw === 'object' && 'parentId' in raw && !!raw.parentId;
    if (bucket === 'comments' && isReply) continue;
    tally[bucket]++;
  }
  return tally;
}

/**
 * The tally as nouns, in the order both surfaces name them, dropping what is
 * zero. The card sets the counts and their words in two tones and the unfurl
 * description writes them as prose, but the buckets, their nouns and their
 * plurals are one decision — so a fourth bucket or a renamed noun cannot leave
 * the card and the description disagreeing about the same annotation.
 */
export function tallyParts(tally: OpTally): { n: number; word: string }[] {
  return [
    { n: tally.comments, word: 'comment' },
    { n: tally.drawings, word: 'drawing' },
    { n: tally.notes, word: 'note' },
  ].filter((p) => p.n > 0);
}

/** What both surfaces say when there is nothing to count. */
export const EMPTY_TALLY_LABEL = 'Shared annotations';

export const plural = ({ n, word }: { n: number; word: string }) => `${word}${n > 1 ? 's' : ''}`;
