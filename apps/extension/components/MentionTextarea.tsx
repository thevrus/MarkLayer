import { Popover } from '@base-ui/react/popover';
import { type Mention, mentionSegments } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren, ComponentProps, Ref } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { matchEmoji } from '../lib/emoji';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import { asMention, matchRoster } from '../lib/roster';
import { Avatar } from './Avatar';

/** Longest `@…` or `:…` run still treated as a name being typed rather than prose. */
const MAX_QUERY = 40;

/** What the caret sits in: a person's name after `@`, or an emoji shortcode after `:`, with the trigger's index. */
interface Query {
  kind: 'mention' | 'emoji';
  at: number;
  text: string;
}

/** Rows the composer's list can offer the caret. One row type, so the list and the highlight never split. */
interface Row {
  key: string;
  insert: () => void;
  node: ComponentChildren;
}

/** The `:` list is a hint, not a browser: the picker under a comment shows the whole table. */
const MAX_EMOJI_ROWS = 8;

/**
 * The mention state a composer ships with its op.
 *
 * Spread `mentionProps` onto the textarea and call `mentions()` when building the
 * op. The ref, `onMentionsChange` and "empty means undefined" live here so a new
 * composer cannot ship `mentions: []` on the wire by forgetting one.
 */
export function useMentions() {
  const tagged = useRef<Mention[]>([]);
  return {
    mentionProps: {
      onMentionsChange: (next: Mention[]) => {
        tagged.current = next;
      },
    },
    mentions: (): Mention[] | undefined => (tagged.current.length > 0 ? tagged.current : undefined),
  };
}

type TextareaProps = Omit<ComponentProps<'textarea'>, 'ref'>;

interface Props extends TextareaProps {
  /** Forwarded to the real textarea, so callers keep reading `.value` off it. */
  taRef?: Ref<HTMLTextAreaElement>;
  /** Fires whenever the set of people still named in the text changes. */
  onMentionsChange?: (mentions: Mention[]) => void;
}

/**
 * The composer textarea, plus the `@` popover that tags someone and the `:` popover that picks an emoji.
 *
 * A wrapper rather than a hook because the popover has to be rendered next to
 * the field, and a wrapper rather than a full composer because the submit
 * gesture is not ours: most panels post on Enter, the inspector ones on
 * ⌘/Ctrl+Enter. So this takes first refusal on the keys it needs while the
 * popover is open and hands every other key straight to the caller's handler.
 */
export function MentionTextarea({ taRef, onMentionsChange, onKeyDown, onInput, onBlur, ...rest }: Props) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  /** `null` closes the popover — distinct from an empty `text`, which is a bare `@` or `:` with everything still eligible. */
  const [query, setQuery] = useState<Query | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  /** Everyone inserted through the popover, by id. Not everyone still in the text. */
  const inserted = useRef(new Map<string, Mention>());

  const rows: Row[] = !query
    ? []
    : query.kind === 'mention'
      ? matchRoster({ query: query.text }).map((entry) => ({
          key: entry.id,
          insert: () => {
            inserted.current.set(entry.id, asMention(entry));
            replaceRun(query.at, `@${entry.name} `);
          },
          node: (
            <>
              <Avatar name={entry.name} color={entry.color} size="sm" dim={!entry.online} />
              <span class="truncate">{entry.name}</span>
              {entry.self && <span class="text-meta text-(--ds-gray-900) shrink-0">you</span>}
            </>
          ),
        }))
      : matchEmoji({ query: query.text, limit: MAX_EMOJI_ROWS }).map((entry) => ({
          key: entry.name,
          insert: () => replaceRun(query.at, `${entry.char} `),
          node: (
            <>
              <span class="w-5 text-center text-ui-lg leading-none" aria-hidden="true">
                {entry.char}
              </span>
              <span class="truncate">{entry.name}</span>
            </>
          ),
        }));
  const count = rows.length;
  const open = count > 0;
  const activeIndex = Math.min(highlighted, count - 1);

  const attach = (node: HTMLTextAreaElement | null) => {
    el.current = node;
    if (typeof taRef === 'function') taRef(node);
    else if (taRef) taRef.current = node;
  };

  /**
   * Someone is only mentioned while their name is still in the prose: backspacing
   * over a tag has to untag them, or an op ships a notification for text nobody
   * can see. Resolved against the body on every keystroke for that reason.
   */
  const report = (value: string) => {
    if (!onMentionsChange) return;
    const candidates = [...inserted.current.values()];
    const present = mentionSegments({ text: value, mentions: candidates })
      .map((segment) => segment.mention)
      .filter((mention): mention is Mention => mention !== undefined);
    const unique = new Map(present.map((mention) => [mention.id, mention]));
    onMentionsChange([...unique.values()]);
  };

  /** The `@…` or `:…` run the caret sits in, or null when the caret is not in one. */
  const queryAt = (node: HTMLTextAreaElement): Query | null => {
    const caret = node.selectionStart ?? 0;
    const upto = node.value.slice(0, caret);
    const at = Math.max(upto.lastIndexOf('@'), upto.lastIndexOf(':'));
    if (at === -1) return null;
    // A trigger starts a word. Without this, `vadym@dutch.com` and `12:30` open the popover.
    const before = at === 0 ? '' : upto.slice(at - 1, at);
    if (before && !/[\s([]/.test(before)) return null;
    const token = upto.slice(at + 1);
    if (token.includes('\n') || token.length > MAX_QUERY) return null;
    if (upto[at] === ':') {
      // Two characters in, like Slack: a bare `:` or `:D` is punctuation, and Enter
      // on it must still send the comment rather than pick 👎 or "confused".
      return /\s/.test(token) || token.length < 2 ? null : { kind: 'emoji', at, text: token };
    }
    // A completed tag is not a query — otherwise inserting `@Name ` immediately
    // reopens the popover on the name it just wrote.
    const done = [...inserted.current.values()].some((m) => m.name.toLowerCase() === token.trim().toLowerCase());
    return done ? null : { kind: 'mention', at, text: token };
  };

  const sync = (node: HTMLTextAreaElement) => {
    const next = queryAt(node);
    setQuery(next);
    setHighlighted(0);
    report(node.value);
  };

  /** Replace the run from the trigger at `at` to the caret with `text`, caret after it. */
  function replaceRun(at: number, text: string) {
    const node = el.current;
    if (!node) return;
    const caret = node.selectionStart ?? node.value.length;
    node.value = node.value.slice(0, at) + text + node.value.slice(caret);
    const pos = at + text.length;
    node.setSelectionRange(pos, pos);
    setQuery(null);
    node.focus();
    report(node.value);
  }

  return (
    <>
      <textarea
        {...rest}
        ref={attach}
        onInput={(e) => {
          if (e.currentTarget instanceof HTMLTextAreaElement) sync(e.currentTarget);
          onInput?.(e);
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : count - 1;
              setHighlighted((i) => (Math.min(i, count - 1) + step) % count);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              rows[activeIndex]?.insert();
              return;
            }
            if (e.key === 'Escape') {
              // Closes the popover only — the panel's own Escape still cancels,
              // so this stops here rather than bubbling out of the composer.
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          setQuery(null);
          onBlur?.(e);
        }}
      />

      <Popover.Root open={open} onOpenChange={(next: boolean) => !next && setQuery(null)}>
        <Popover.Portal container={portalContainer.value ?? undefined}>
          <Popover.Positioner
            anchor={el.current}
            positionMethod="fixed"
            // Below the field, never above it: every composer that hosts this has
            // its own header directly over the textarea, and a list placed on
            // that side lands inside the card and covers it.
            side="bottom"
            align="start"
            sideOffset={5}
            collisionPadding={6}
            className="z-2147483647 outline-none"
          >
            {/* Focus never leaves the field: the caret has to keep moving while the
                list is up, which is also why the arrow keys are handled above
                rather than by the popup. */}
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              // A hover sets `highlighted` on enter but nothing ever cleared it on
              // exit, so the last-hovered row stayed lit after the pointer left —
              // reset to the keyboard default once the pointer leaves the list.
              onMouseLeave={() => setHighlighted(0)}
              // Exactly as wide as the field it belongs to, so both edges line up
              // with the textarea above instead of stopping short of the card.
              className={cn(
                'w-(--anchor-width) max-h-52 overflow-y-auto',
                glass.menuPopup,
                geist.surfaceSmall,
                glass.font,
              )}
            >
              {rows.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  // Pointer-down, not click: a click fires after blur, which has
                  // already closed the popover and taken the row with it.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    row.insert();
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  class={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left',
                    'text-ui font-medium leading-none',
                    glass.menuItem,
                    glass.menuItemHighlight,
                    i === activeIndex && 'bg-(--ds-gray-alpha-100)',
                  )}
                >
                  {row.node}
                </button>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
