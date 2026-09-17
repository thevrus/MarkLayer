import { cn, type Mention, mentionSegments } from '@marklayer/types';
import { useMemo } from 'preact/hooks';
import { rosterNames } from '../lib/roster';
import { localUser } from '../lib/state';

const URL_RE = /https?:\/\/[^\s<>"'“”]+/g;
const LINK_CLASS =
  'text-(--ds-gray-1000) underline underline-offset-2 decoration-(--ds-gray-alpha-400) hover:decoration-(--ds-gray-1000)';

/** A pasted URL is prose input, not a display string — shorten it to host + the tail of its path. */
function shortenUrl(url: string, max = 46): string {
  const clip = (s: string) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '');
    path = decodeURIComponent(parsed.pathname.replace(/\/$/, ''));
  } catch {
    return clip(url);
  }
  const full = host + path;
  if (full.length <= max) return full;
  const tail = path.split('/').filter(Boolean).at(-1) ?? '';
  return clip(tail ? `${host}/…/${tail}` : host);
}

/**
 * Split a run of plain prose into text and pasted-link pieces.
 *
 * Trailing punctuation (a period ending the sentence, a comma before the next
 * clause) is trimmed off the match rather than swallowed into the href — a
 * closing bracket is kept only when it balances one that's actually inside
 * the URL, so a link written in parens still gets its own `)` back.
 */
function splitLinks(text: string): Array<{ text: string; url?: string }> {
  if (!/https?:\/\//.test(text)) return [{ text }];
  const parts: Array<{ text: string; url?: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    let end = start + raw.length;
    while (raw.length > 0 && /[.,;:!?)\]]$/.test(raw)) {
      const last = raw.at(-1);
      if ((last === ')' && raw.includes('(')) || (last === ']' && raw.includes('['))) break;
      raw = raw.slice(0, -1);
      end -= 1;
    }
    if (!raw) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: raw, url: raw });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

function LinkedText({ text }: { text: string }) {
  const parts = useMemo(() => splitLinks(text), [text]);
  if (parts.length === 1 && !parts[0]?.url) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.url ? (
          <a
            key={`${i}-link`}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            class={LINK_CLASS}
            title={part.url}
          >
            {shortenUrl(part.url)}
          </a>
        ) : (
          <span key={`${i}-text`}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Comment prose with its `@mentions` set apart and any pasted URLs made
 * clickable (and shortened — a raw share link can run to 100+ characters).
 *
 * The mention distinction is tonal, not coloured: a tag is the same ink as
 * the sentence it sits in, one step stronger and a weight heavier, and a tag
 * pointing at you is heavier again. A saturated token (or a tinted chip
 * around it) would read as a component-kit badge and fight every other
 * colour in the panel — and the one thing a mention has to do is stay
 * legible inside a sentence. Links get the same restraint: an underline on
 * the existing ink, not a coloured or boxed treatment.
 *
 * The name shown is the person's current one, not the snapshot the text was
 * written with, which is why a rename needs no rewriting of anyone's prose: the
 * stored name still marks where the tag sits, and the roster says what to call
 * them now.
 */
export function MentionText({ text, mentions }: { text: string; mentions?: Mention[] }) {
  const segments = mentionSegments({ text, mentions });
  // Nothing tagged: skip subscribing this component to the roster, which every
  // comment in a list would otherwise do — but still linkify.
  if (segments.every((segment) => !segment.mention)) return <LinkedText text={text} />;
  const current = rosterNames.value;

  return (
    <span>
      {segments.map((segment, i) => {
        const { mention } = segment;
        if (!mention) return <LinkedText key={`${i}-plain`} text={segment.text} />;
        const me = mention.id === localUser.id;
        const name = current.get(mention.id) ?? mention.name;
        return (
          <span
            // Segments have no id of their own; position in one immutable body is stable.
            key={`${i}-${mention.id}`}
            class={cn('text-(--ds-gray-1000)', me ? 'font-semibold' : 'font-medium')}
            title={me ? 'Mentions you' : `Mentions ${name}`}
          >
            @{name}
          </span>
        );
      })}
    </span>
  );
}
