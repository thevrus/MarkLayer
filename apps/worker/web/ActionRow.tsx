import { cn } from '@marklayer/ui/cn';
import type { ComponentChildren } from 'preact';

const ROW_CLS = cn(
  'text-ui flex h-9 w-full items-center gap-2 px-3.5 text-left font-normal no-underline max-md:h-12 max-md:px-4',
  'appearance-none border-none bg-transparent text-(--ds-gray-1000) cursor-pointer',
  'transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)',
  'disabled:pointer-events-none disabled:opacity-50',
  // Inset: the row is full-bleed inside an `overflow-hidden` shell, so an outset ring would be clipped.
  'outline-none focus-visible:outline-solid focus-visible:outline-2',
  'focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-color)',
);

/** A full-bleed action row: bare glyph, label, optional trailing mark. A button, or a link when `href` is set. */
export function ActionRow({
  icon,
  trailing,
  onClick,
  href,
  disabled,
  expanded,
  children,
}: {
  icon: ComponentChildren;
  trailing?: ComponentChildren;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  expanded?: boolean;
  children: ComponentChildren;
}) {
  const body = (
    <>
      <span class="flex w-4 shrink-0 items-center justify-center text-(--ds-gray-900)">{icon}</span>
      <span class="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span class="flex shrink-0 items-center text-(--ds-gray-900)">{trailing}</span>}
    </>
  );
  if (href) {
    return (
      <a href={href} class={ROW_CLS}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" class={ROW_CLS} onClick={onClick} disabled={disabled} aria-expanded={expanded}>
      {body}
    </button>
  );
}
