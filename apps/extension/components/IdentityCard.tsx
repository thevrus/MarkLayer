import { Popover } from '@base-ui/react/popover';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { cn } from '@marklayer/types';
import { Check, Shuffle } from 'lucide-preact';
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import {
  CURSOR_COLORS,
  cursorColorName,
  localUser,
  peers,
  randomUserName,
  relabelOwnWork,
  setUserColor,
  setUserName,
} from '../lib/state';
import { Avatar } from './Avatar';

/**
 * Your own identity, as one control: the avatar you already recognize in the
 * presence stack opens a card holding the name and the cursor color behind it.
 *
 * A rename is live on the wire (`profile`), so everything here applies as you
 * type and the card needs no Save, no Cancel and no commit-on-blur guessing.
 * The part that is not free is your existing work: `author` is a stored string,
 * so closing the card carries the new name onto the annotations you already
 * wrote (see `relabelOwnWork`) rather than leaving you in the room twice.
 */
export function IdentityCard() {
  const [open, setOpen] = useState(false);
  // The draft exists only so the field can sit empty mid-retype: every non-empty
  // keystroke is already applied, so there is nothing to commit or revert.
  const [draft, setDraft] = useState(localUser.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const apply = (next: string) => {
    setDraft(next);
    setUserName(next);
  };
  const shown = draft.trim() || localUser.name;
  // Two people under one name breaks assignment, which addresses people by name.
  const taken = Array.from(peers.value.values()).some((p) => p.name === shown);

  const close = () => {
    // Closing is the "done" moment: carry the rename onto existing work now
    // rather than leaving it to the settle timer in `setUserName`. A field left
    // empty goes back to the name that is actually in effect.
    setDraft(localUser.name);
    relabelOwnWork();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) close();
      }}
    >
      <Popover.Trigger
        className={cn(
          'flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-md shrink-0 cursor-pointer',
          'appearance-none border-none bg-transparent outline-none',
          'transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)',
          'data-popup-open:bg-(--ds-gray-alpha-100)',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-(--ds-focus-color)',
        )}
        aria-label={`You, ${localUser.name}. Edit your name and color`}
      >
        <Avatar name={localUser.name} color={localUser.color} />
        <span class="max-w-24 truncate text-ui font-medium text-(--ds-gray-1000)">{localUser.name}</span>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer.value ?? undefined}>
        <Popover.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-2147483647 outline-none"
        >
          <Popover.Popup
            initialFocus={inputRef}
            className={cn(geist.surface, glass.font, 'w-[272px] p-3 outline-none')}
          >
            <Popover.Title className="sr-only">Your name and color</Popover.Title>
            <NameRow
              inputRef={inputRef}
              draft={draft}
              shown={shown}
              apply={apply}
              onDone={() => {
                // `open` is controlled, so setting it does not run onOpenChange.
                setOpen(false);
                close();
              }}
            />
            <p class={cn(geist.sectionLabel, 'mt-3 mb-1.5')}>Cursor color</p>
            <ColorRow />
            {/* One slot for both lines, sized for the longer of the two, so a
                collision notice cannot jog the card taller under the pointer. */}
            <Popover.Description className="mt-3 block min-h-9 text-meta leading-body text-(--ds-gray-900)">
              {taken ? (
                <span class="font-medium text-(--ds-gray-1000)">That name is taken in this room.</span>
              ) : (
                'Peers see this on your cursor and your comments.'
              )}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NameRow({
  inputRef,
  draft,
  shown,
  apply,
  onDone,
}: {
  inputRef: RefObject<HTMLInputElement>;
  draft: string;
  /** What the name resolves to right now — the draft, or the applied name while the field sits empty. */
  shown: string;
  apply: (next: string) => void;
  onDone: () => void;
}) {
  return (
    <div class="flex items-center gap-2">
      <Avatar name={shown} color={localUser.color} />
      <div class={cn(geist.field, 'flex-1 min-w-0 flex items-center gap-1 pl-2.5 pr-1')}>
        <input
          ref={inputRef}
          name="displayName"
          type="text"
          value={draft}
          maxLength={24}
          placeholder={localUser.name}
          autoComplete="off"
          spellcheck={false}
          aria-label="Your name"
          class={cn(geist.input, 'flex-1 h-8 truncate cursor-text')}
          onInput={(e) => apply(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onDone();
          }}
        />
        <button
          type="button"
          aria-label="Pick a random name"
          class={cn(
            'h-6 w-6 grid place-items-center shrink-0 rounded-md cursor-pointer',
            'appearance-none border-none bg-transparent outline-none',
            'text-(--ds-gray-900) transition-colors duration-150',
            'hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)',
            'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--ds-focus-color)',
          )}
          onClick={() => {
            apply(randomUserName());
            inputRef.current?.focus();
          }}
        >
          <Shuffle size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * One 24px hit area per color with a 16px disc centered in it, laid edge to
 * edge: the discs read as a spaced row while the targets stay pointer-sized.
 *
 * The chosen one is marked inside the disc rather than ringed outside it. Ten
 * swatches leave 24px of pitch, so any ring wide enough to read would eat the
 * gap to its neighbour and turn the row ragged — and a ring with a gap inside
 * it reads as a target at this size. The check is the disc's own hue dropped
 * most of the way to black, so it stays legible on all ten without a second
 * color entering the card.
 */
const SWATCH_INK = 'color-mix(in oklab, currentColor 20%, black)';

function ColorRow() {
  return (
    <RadioGroup
      value={localUser.color}
      onValueChange={(next: string) => setUserColor(next)}
      aria-label="Cursor color"
      className="flex items-center -mx-1"
    >
      {CURSOR_COLORS.map((c) => (
        <Radio.Root
          key={c}
          value={c}
          aria-label={cursorColorName(c)}
          className={cn(
            'h-6 w-6 grid place-items-center shrink-0 rounded-full cursor-pointer',
            // The same tonal fill every other control in the product answers a
            // pointer with, rather than a ring in the swatch's own color that
            // is either invisible at 16px or crowds its neighbour.
            'transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)',
            'outline-none focus-visible:outline-solid focus-visible:outline-2',
            'focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
          )}
          style={{ color: c }}
        >
          <span class="w-4 h-4 rounded-full bg-current grid place-items-center">
            {c === localUser.color && (
              <Check size={11} strokeWidth={3} style={{ color: SWATCH_INK }} aria-hidden="true" />
            )}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
