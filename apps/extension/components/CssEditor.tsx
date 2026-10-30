import type { StyleEdit } from '@marklayer/types';
import { cn } from '@marklayer/types';
import { type Signal, useSignal } from '@preact/signals';
import { Search, Undo2 } from 'lucide-preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { track } from '../lib/analytics';
import { GLYPH, geist } from '../lib/geist';
import { createStyleSession, isColorValue, nudgeValue, readStyles, type StyleSession } from '../lib/style-edit';
import { Tooltip } from './Tooltip';

/** Name, value, revert: one template for every row, so both columns hold one x down the list. */
const ROW_GRID = 'grid grid-cols-[7.5rem_minmax(0,1fr)_1.5rem] items-center gap-x-2';

/**
 * Live CSS editing for one element. Edits preview on the page as they are typed
 * and are reverted when this unmounts, so the page is never left altered; the
 * diff reaches the caller through `onChange` on every commit, Esc and nudge.
 */
export function CssEditor({ el, onChange }: { el: Element; onChange: (edits: StyleEdit[]) => void }) {
  const session = useMemo(() => createStyleSession(el), [el]);
  // The page's DOM is not a signal; the session is the integration boundary to clean up.
  useEffect(() => () => session.revertAll(), [session]);

  const query = useSignal('');
  // Bumped after every mutation: computed values shift with an edit (font-size moves line-height).
  const version = useSignal(0);
  const v = version.value;

  // ~40 computed-style reads: keyed on `version` so filter keystrokes don't repeat them.
  const all = useMemo(() => readStyles(el), [el, v]);
  const editedTo = useMemo(() => new Map(session.edits().map((e) => [e.property, e])), [session, v]);
  const needle = query.value.trim().toLowerCase();
  const rows = all.filter((row) => row.property.includes(needle));

  const changed = () => {
    version.value++;
    onChange(session.edits());
  };
  // Nudges stay silent: the blur that ends the edit reports the settled result once.
  const reported = useRef({ sig: '', count: 0 });
  const committed = () => {
    changed();
    const current = session.edits();
    const sig = current.map((e) => `${e.property}:${e.to}`).join('|');
    if (sig === reported.current.sig) return;
    track('css_edit_applied', { edits: current.length, reverted: current.length < reported.current.count });
    reported.current = { sig, count: current.length };
  };

  return (
    <div class="flex flex-col min-h-0">
      <div class="px-4 pt-3 pb-2">
        <label class={cn(geist.field, 'flex items-center gap-2 px-2.5')}>
          <Search size={14} strokeWidth={GLYPH.strokeWidth} class="shrink-0 text-(--ds-gray-900)" aria-hidden />
          <input
            type="text"
            value={query.value}
            onInput={(e) => {
              query.value = e.currentTarget.value;
            }}
            placeholder="Filter properties"
            aria-label="Filter CSS properties"
            spellcheck={false}
            class={cn(geist.input, 'flex-1 h-full')}
          />
        </label>
      </div>

      <ul class="m-0 p-0 pb-2 list-none overflow-y-auto min-h-0 max-h-[320px]">
        {rows.map(({ property, value }) => {
          const edit = editedTo.get(property);
          return (
            <PropertyRow
              key={property}
              property={property}
              value={edit?.to ?? value}
              from={edit?.from}
              session={session}
              version={version}
              onCommit={committed}
              onEdit={changed}
            />
          );
        })}
        {!rows.length && <li class={cn(geist.meta, 'px-4 py-2')}>No property matches “{query.value.trim()}”</li>}
      </ul>
    </div>
  );
}

function PropertyRow({
  property,
  value,
  from,
  session,
  version,
  onCommit,
  onEdit,
}: {
  property: string;
  value: string;
  /** Present only when the property is edited. */
  from: string | undefined;
  session: StyleSession;
  version: Signal<number>;
  onCommit: () => void;
  onEdit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // What is being typed; null when the field is at rest and shows the live value.
  const draft = useSignal<string | null>(null);
  const invalid = useSignal(false);
  const shown = draft.value ?? value;
  const edited = from !== undefined;

  const preview = (next: string) => {
    draft.value = next;
    invalid.value = !session.apply({ property, value: next });
    version.value++;
  };
  const revert = () => {
    session.revert(property);
    draft.value = null;
    invalid.value = false;
    onCommit();
  };
  // The key handlers are bound once; this keeps them calling this render's callbacks, not the first one's.
  const live = useRef({ preview, revert, onEdit });
  live.current = { preview, revert, onEdit };

  // Bound on the input itself: tinykeys ignores keys aimed at an input from any other listener.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const nudge = (delta: number) => (e: KeyboardEvent) => {
      const next = nudgeValue({ value: draft.value ?? input.value, delta });
      if (next === null) return;
      e.preventDefault();
      live.current.preview(next);
      live.current.onEdit();
    };
    return tinykeys(input, {
      Enter: (e) => {
        e.preventDefault();
        input.blur();
      },
      Escape: (e) => {
        // Held here so Esc reverts the field rather than also closing the panel around it.
        e.stopPropagation();
        live.current.revert();
        input.blur();
      },
      ArrowUp: nudge(1),
      ArrowDown: nudge(-1),
      'Shift+ArrowUp': nudge(10),
      'Shift+ArrowDown': nudge(-10),
    });
  }, [draft]);

  return (
    <li class={cn(ROW_GRID, 'h-8 px-4')}>
      <span
        title={property}
        class={cn('truncate text-meta', edited ? 'font-medium text-(--ds-gray-1000)' : 'text-(--ds-gray-900)')}
      >
        {property}
      </span>

      <span
        class={cn(
          'flex items-center gap-1.5 h-6 min-w-0 px-1.5 -mx-1.5 rounded-md border border-transparent',
          'transition-[background-color,border-color] duration-150 ease-out',
          'hover:bg-(--ds-gray-alpha-100) focus-within:bg-(--ds-background-100) focus-within:border-(--ds-gray-700)',
        )}
      >
        {isColorValue(shown) && (
          <span
            aria-hidden
            class="size-3 shrink-0 rounded-sm [box-shadow:inset_0_0_0_1px_var(--ds-gray-alpha-400)]"
            style={{ backgroundColor: shown }}
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={shown}
          aria-label={property}
          aria-invalid={invalid.value}
          spellcheck={false}
          autocomplete="off"
          onFocus={(e) => {
            draft.value = e.currentTarget.value;
            e.currentTarget.select();
          }}
          onInput={(e) => preview(e.currentTarget.value)}
          onBlur={() => {
            if (draft.value === null) return;
            draft.value = null;
            invalid.value = false;
            onCommit();
          }}
          class={cn(
            'min-w-0 flex-1 bg-transparent border-none outline-none p-0',
            'font-mono text-meta tabular-nums',
            invalid.value ? 'text-(--ds-red-700)' : 'text-(--ds-gray-1000)',
          )}
        />
      </span>

      {edited ? (
        <button
          type="button"
          onClick={revert}
          aria-label={`Revert ${property} to ${from || 'unset'}`}
          class={cn('group', geist.ctlXs, geist.ctlIdle)}
        >
          <Undo2 size={14} strokeWidth={GLYPH.strokeWidth} aria-hidden />
          <Tooltip text={`Revert to ${from || 'unset'}`} />
        </button>
      ) : (
        <span aria-hidden />
      )}
    </li>
  );
}
