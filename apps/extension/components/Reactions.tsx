import { Popover } from '@base-ui/react/popover';
import { groupReactions, type Reaction } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { SmilePlus } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { useCardHold } from '../lib/card-hold';
import { EMOJI, matchEmoji } from '../lib/emoji';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { localUser } from '../lib/identity';
import { toggleOpReaction } from '../lib/ops';
import { portalContainer } from '../lib/portal';

const pill = `
  inline-flex items-center gap-1 h-6 px-2 rounded-full cursor-pointer
  text-meta font-medium tabular-nums leading-none text-(--ds-gray-1000)
  border transition-[background-color,border-color] duration-150 ease-out
`;

/**
 * The reaction row under a comment or reply: one pill per emoji, the picker at
 * the end. Toggling re-sends the whole list as an `update_op` patch, so two
 * people reacting in the same instant can lose one — acceptable for a row of
 * emoji, where the fix is to click again.
 */
export function Reactions({
  opId,
  reactions,
  class: cls,
}: {
  opId: string;
  reactions: Reaction[] | undefined;
  class?: string;
}) {
  const react = (emoji: string) => toggleOpReaction({ opId, emoji });
  return (
    <div class={cn('flex flex-wrap items-center gap-1.5', cls)}>
      {groupReactions(reactions).map(({ emoji, by }) => {
        const mine = by.some((p) => p.id === localUser.id);
        const names = by.map((p) => p.name).join(', ');
        return (
          <button
            key={emoji}
            type="button"
            title={names}
            aria-label={`${emoji} ${by.length}, ${names}`}
            aria-pressed={mine}
            onClick={() => react(emoji)}
            class={cn(
              pill,
              mine
                ? 'border-(--ds-blue-800) bg-[color-mix(in_oklch,var(--ds-blue-800)_14%,transparent)]'
                : 'border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100) hover:border-(--ds-gray-700)',
            )}
          >
            <span aria-hidden="true">{emoji}</span>
            {by.length}
          </button>
        );
      })}
      <ReactionPicker onPick={react} />
    </div>
  );
}

/** The smiley that opens a searchable grid. Search filters the same table the `:` composer uses. */
function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const hold = useCardHold();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const shown = query ? matchEmoji({ query }) : EMOJI;

  // Every open and close goes through here, so the card's hold count stays balanced.
  const change = (next: boolean) => {
    setOpen(next);
    hold?.(next);
    if (!next) setQuery('');
  };
  const pick = (char: string) => {
    onPick(char);
    change(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger
        aria-label="Add reaction"
        class={cn(geist.ctlXs, 'rounded-full text-(--ds-gray-900) hover:text-(--ds-gray-1000)')}
      >
        <SmilePlus size={14} strokeWidth={1.75} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal container={portalContainer.value ?? undefined}>
        <Popover.Positioner
          positionMethod="fixed"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={6}
          className="z-2147483647 outline-none"
        >
          <Popover.Popup
            initialFocus={search}
            className={cn('w-56 p-2', glass.menuPopup, geist.surfaceSmall, glass.font)}
          >
            <input
              ref={search}
              type="search"
              value={query}
              placeholder="Search…"
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                const first = shown[0];
                if (e.key === 'Enter' && first) {
                  e.preventDefault();
                  pick(first.char);
                }
              }}
              class={cn(
                'w-full h-7 px-2 mb-2 rounded-md outline-none text-ui',
                'bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) text-(--ds-gray-1000)',
                'focus:border-(--ds-gray-700) placeholder:text-(--ds-gray-900)',
              )}
            />
            {shown.length === 0 ? (
              <p class="m-0 px-1 py-2 text-meta text-(--ds-gray-900)">No match</p>
            ) : (
              <div class="grid grid-cols-6 gap-0.5">
                {shown.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    title={`:${entry.name}:`}
                    onClick={() => pick(entry.char)}
                    class={cn('h-8 rounded-md text-ui-lg leading-none', glass.menuItem, glass.menuItemHighlight)}
                  >
                    {entry.char}
                  </button>
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
