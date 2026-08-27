/**
 * What is left of the liquid-glass system after the Geist migration: the Base UI
 * menu row recipes and the font stack.
 * Opaque panels and bars come from `geist` instead.
 */

export const glass = {
  /** Base UI `Menu.Popup` shell — the context menu and the triage dropdowns share it. */
  menuPopup: 'py-1 select-none outline-none animate-[mlPanelIn_140ms_cubic-bezier(0.16,1,0.3,1)]',

  /** Interactive menu row: the part every row shares, whatever its colour. */
  menuItem: 'outline-none cursor-pointer transition-[background-color,color] duration-100',

  /** The default (non-danger) menu row colours and highlight states. */
  menuItemHighlight: 'text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) data-highlighted:bg-(--ds-gray-alpha-100)',

  /** Font stack */
  font: "font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','Geist',system-ui,sans-serif]",
} as const;
