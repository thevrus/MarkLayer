import { Popover } from '@base-ui/react/popover';
import { cn, type Mention, mentionSegments } from '@marklayer/types';
import type { ComponentProps, Ref } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import { asMention, matchRoster, type RosterEntry } from '../lib/roster';
import { Avatar } from './Avatar';

/** Longest `@…` run still treated as someone's name being typed rather than prose. */
const MAX_QUERY = 40;

/**
 * The mention state a composer ships with its op.
 *
 * Spread `mentionProps` onto the textarea and call `mentions()` when building the
 * op. Every composer used to hold its own ref, wire its own `onMentionsChange`
 * and restate "empty means undefined" at the op literal — three lines that had
 * already drifted apart. Holding them here means a new composer cannot ship
 * `mentions: []` on the wire by forgetting one.
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
 * The composer textarea, plus the `@` popover that tags someone.
 *
 * A wrapper rather than a hook because the popover has to be rendered next to
 * the field, and a wrapper rather than a full composer because the submit
 * gesture is not ours: most panels post on Enter, the inspector ones on
 * ⌘/Ctrl+Enter. So this takes first refusal on the keys it needs while the
 * popover is open and hands every other key straight to the caller's handler.
 */
export function MentionTextarea({ taRef, onMentionsChange, onKeyDown, onInput, onBlur, ...rest }: Props) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  /** `null` closes the popover — distinct from `''`, which is a bare `@` with everyone still eligible. */
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  /** Everyone inserted through the popover, by id. Not everyone still in the text. */
  const inserted = useRef(new Map<string, Mention>());

  const matches = query === null ? [] : matchRoster({ query });
  const open = matches.length > 0;
  const active = matches[Math.min(highlighted, matches.length - 1)];

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

  /** The `@…` run the caret sits in, or null when the caret is not in one. */
  const queryAt = (node: HTMLTextAreaElement): string | null => {
    const caret = node.selectionStart ?? 0;
    const upto = node.value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) return null;
    // A tag starts a word. Without this, `vadym@dutch.com` opens the popover.
    const before = at === 0 ? '' : upto.slice(at - 1, at);
    if (before && !/[\s([]/.test(before)) return null;
    const token = upto.slice(at + 1);
    if (token.includes('\n') || token.length > MAX_QUERY) return null;
    // A completed tag is not a query — otherwise inserting `@Name ` immediately
    // reopens the popover on the name it just wrote.
    const done = [...inserted.current.values()].some((m) => m.name.toLowerCase() === token.trim().toLowerCase());
    return done ? null : token;
  };

  const sync = (node: HTMLTextAreaElement) => {
    const next = queryAt(node);
    setQuery(next);
    setHighlighted(0);
    report(node.value);
  };

  const insert = (entry: RosterEntry) => {
    const node = el.current;
    if (!node) return;
    const caret = node.selectionStart ?? node.value.length;
    const at = node.value.slice(0, caret).lastIndexOf('@');
    if (at === -1) return;
    const tag = `@${entry.name} `;
    node.value = node.value.slice(0, at) + tag + node.value.slice(caret);
    const pos = at + tag.length;
    node.setSelectionRange(pos, pos);
    inserted.current.set(entry.id, asMention(entry));
    setQuery(null);
    node.focus();
    report(node.value);
  };

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
              const step = e.key === 'ArrowDown' ? 1 : matches.length - 1;
              setHighlighted((i) => (Math.min(i, matches.length - 1) + step) % matches.length);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && active) {
              e.preventDefault();
              insert(active);
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
              // Exactly as wide as the field it belongs to, so both edges line up
              // with the textarea above instead of stopping short of the card.
              className={cn(
                'w-(--anchor-width) max-h-52 overflow-y-auto',
                glass.menuPopup,
                geist.surfaceSmall,
                glass.font,
              )}
            >
              {matches.map((entry, i) => (
                <button
                  key={entry.id}
                  type="button"
                  // Pointer-down, not click: a click fires after blur, which has
                  // already closed the popover and taken the row with it.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(entry);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  class={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left',
                    'text-ui font-medium leading-none',
                    glass.menuItem,
                    glass.menuItemHighlight,
                    entry === active && 'bg-(--ds-gray-alpha-100)',
                  )}
                >
                  <Avatar name={entry.name} color={entry.color} size="sm" dim={!entry.online} />
                  <span class="truncate">{entry.name}</span>
                  {entry.self && <span class="text-meta text-(--ds-gray-900) shrink-0">you</span>}
                </button>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
