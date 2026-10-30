export interface EmojiEntry {
  /** GitHub shortcode, without the colons. */
  name: string;
  char: string;
  aliases?: string[];
}

/**
 * Deliberately short: this is a review tool, not a chat app. GitHub's eight
 * reactions, then the verdicts a review thread needs: done, no, careful, unclear, bug, idea.
 */
export const EMOJI: readonly EmojiEntry[] = [
  { name: '+1', char: '👍', aliases: ['thumbsup'] },
  { name: '-1', char: '👎', aliases: ['thumbsdown'] },
  { name: 'smile', char: '😄', aliases: ['laugh'] },
  { name: 'tada', char: '🎉', aliases: ['hooray'] },
  { name: 'confused', char: '😕' },
  { name: 'heart', char: '❤️' },
  { name: 'eyes', char: '👀' },
  { name: 'rocket', char: '🚀' },
  { name: 'white_check_mark', char: '✅', aliases: ['check'] },
  { name: 'x', char: '❌' },
  { name: 'warning', char: '⚠️' },
  { name: 'question', char: '❓' },
  { name: 'bulb', char: '💡', aliases: ['idea'] },
  { name: 'bug', char: '🐛' },
];

const keysOf = ({ name, aliases = [] }: EmojiEntry) => [name, ...aliases];

/** Prefix hits before substring hits, table order within each; no `limit` returns every hit. */
export function matchEmoji({ query, limit = EMOJI.length }: { query: string; limit?: number }): EmojiEntry[] {
  const q = query.toLowerCase();
  if (!q) return EMOJI.slice(0, limit);
  const prefix: EmojiEntry[] = [];
  const infix: EmojiEntry[] = [];
  for (const entry of EMOJI) {
    const keys = keysOf(entry);
    if (keys.some((k) => k.startsWith(q))) prefix.push(entry);
    else if (keys.some((k) => k.includes(q))) infix.push(entry);
  }
  return [...prefix, ...infix].slice(0, limit);
}
