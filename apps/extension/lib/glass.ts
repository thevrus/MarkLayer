/** Shared liquid-glass surface tokens using CSS custom properties for theme support */

export const glass = {
  /** Primary surface — toolbar, popover panels. */
  surface: `
    bg-[var(--ml-glass-bg)]
    [background-image:var(--ml-glass-gloss,none)]
    backdrop-blur-[80px] backdrop-saturate-[1.9] backdrop-brightness-[1.1]
    border border-[var(--ml-glass-border)]
    [box-shadow:var(--ml-glass-shadow)]
    rounded-[22px]
  `
    .replace(/\n\s+/g, ' ')
    .trim(),

  /** Smaller floating surface — tooltips, hover cards */
  surfaceSmall: `
    bg-[var(--ml-glass-bg-small)]
    backdrop-blur-[72px] backdrop-saturate-[1.7] backdrop-brightness-[1.1]
    border border-[var(--ml-glass-border)]
    [box-shadow:var(--ml-glass-shadow-small)]
    rounded-2xl
  `
    .replace(/\n\s+/g, ' ')
    .trim(),

  /** Base UI `Menu.Popup` shell — the context menu and the triage dropdowns share it. */
  menuPopup: 'py-1 select-none outline-none animate-[mlPanelIn_140ms_cubic-bezier(0.16,1,0.3,1)]',

  /** Interactive menu row: the part every row shares, whatever its colour. */
  menuItem: 'outline-none cursor-pointer transition-[background-color,color] duration-100',

  /** The default (non-danger) menu row colours and highlight states. */
  menuItemHighlight:
    'text-ml-glass-fg/80 hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg data-highlighted:bg-ml-glass-fg/10 data-highlighted:text-ml-glass-fg',

  /** Divider line */
  divider: 'h-px bg-gradient-to-r from-transparent via-[var(--ml-glass-divider)] to-transparent',

  /** Vertical separator */
  sep: 'w-px h-6 bg-gradient-to-b from-transparent via-[var(--ml-glass-sep)] to-transparent shrink-0 mx-1.5',

  /** Font stack */
  font: "font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','Geist',system-ui,sans-serif]",
} as const;
