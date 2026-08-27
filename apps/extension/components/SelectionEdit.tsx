import { cn } from '@marklayer/types';
import { Replace } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { textareaCls } from '../lib/buttons';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';

const quote = 'text-[13px] m-0 mt-1 line-clamp-3 leading-relaxed';

interface Props {
  /** The text that was selected — the "before" side, and what a suggestion replaces. */
  text: string;
  /** Draft replacement. `null` means the field is closed; '' means open and empty. */
  suggestion: string | null;
  onChange: (next: string | null) => void;
  /** Enter in the field saves the whole annotation, matching the comment field. */
  onSubmit: () => void;
}

/**
 * The selected-text block of a selection popover, which doubles as the composer
 * for a proposed replacement: closed it just quotes the selection, open it shows
 * the original struck through above the editable replacement, so the two sides
 * read as a diff. The field opens pre-filled with the original because the job is
 * almost always changing a word or two rather than rewriting the passage.
 */
export function SelectionEdit({ text, suggestion, onChange, onSubmit }: Props) {
  const open = suggestion !== null;
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Caret at the end rather than at 0, so the pre-filled original is ready to be
  // edited from where the eye already is.
  useEffect(() => {
    if (!open) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [open]);

  return (
    <>
      {/* Open, the block below it is a second labelled field rather than a divider,
          so the pair needs more air between them than the closed state does. */}
      <div class={cn('px-4 pt-3.5', open ? 'pb-3' : 'pb-2')}>
        <span class={geist.sectionLabel}>{open ? 'Original' : 'Selected text'}</span>
        <p class={cn(quote, open ? 'text-(--ds-gray-900) line-through' : 'text-(--ds-gray-1000)')}>"{text}"</p>
        {!open && (
          <button
            type="button"
            onClick={() => onChange(text)}
            title="Propose replacement text for this selection"
            class="inline-flex items-center gap-1.5 mt-2 -ml-1.5 rounded-lg px-1.5 py-1
                   text-[12px] font-medium text-(--ds-gray-900) bg-transparent border-none cursor-pointer
                   transition-colors hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)"
          >
            <Replace size={14} strokeWidth={2.25} />
            Suggest an edit
          </button>
        )}
      </div>

      {open && (
        <div class="px-4 pb-2">
          <div class="flex items-baseline justify-between gap-2 mb-1">
            <span class={geist.sectionLabel}>Replace with</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              class="text-[12px] font-medium text-(--ds-gray-900) hover:text-(--ds-gray-1000)
                     bg-transparent border-none cursor-pointer p-0 transition-colors"
            >
              Remove
            </button>
          </div>
          <textarea
            ref={taRef}
            name="suggestion"
            aria-label="Replacement text"
            value={suggestion}
            rows={1}
            onInput={(e) => onChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              } else if (e.key === 'Escape') {
                // Closes the field only. The popover's own Escape still cancels
                // the annotation, so this stops here rather than bubbling.
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }
            }}
            class={cn(textareaCls, 'w-full min-h-10 max-h-[140px]', glass.font)}
            style={{ fieldSizing: 'content', boxSizing: 'border-box' }}
          />
        </div>
      )}
    </>
  );
}

/**
 * Read-only diff for hover cards and the annotation list: the replaced text struck
 * through, then the replacement. The arrow carries the meaning, so the pair still
 * reads as a substitution when the two lines wrap or clamp.
 */
export function SuggestionDiff({
  text,
  suggestion,
  resolved,
  class: cls,
}: {
  text: string;
  suggestion: string;
  /** Matches the de-emphasis every other resolved annotation already gets. */
  resolved?: boolean;
  class?: string;
}) {
  return (
    <div class={cn(resolved && 'opacity-50', cls)}>
      <p class={cn(quote, 'mt-0 text-(--ds-gray-900) line-through')}>"{text}"</p>
      {/* Hanging indent so wrapped lines align under the replacement text rather
          than under the arrow, keeping the two sides of the diff on one edge. */}
      <p class={cn(quote, 'text-(--ds-gray-1000) pl-4 -indent-4')}>
        <span aria-hidden="true" class="text-(--ds-gray-900) mr-1">
          →
        </span>
        {suggestion}
      </p>
    </div>
  );
}
