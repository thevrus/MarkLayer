/**
 * Geist — the class recipes the toolbar and its tooltip are built from, in the
 * Geist design language. The values they consume live in each app's stylesheet
 * as `--ds-*`, copied from the CSS the design system ships.
 *
 * Opaque surfaces, one flat fill per state, a 1px hairline carried by the
 * shadow's first layer, and no motion on hover — the older `--ml-glass-*`
 * recipes in glass.ts still dress the panels.
 */

import { trim } from './buttons';

export const geist = {
  /** Floating shell. `shadow-menu` opens with a 1px ring, so no border here. */
  surface: trim(`
    bg-(--ds-background-100)
    [box-shadow:var(--ds-shadow-menu)]
    rounded-xl
  `),

  /** Tooltip / small popup shell. */
  surfaceSmall: trim(`
    bg-(--ds-background-100)
    [box-shadow:var(--ds-shadow-tooltip)]
    rounded-md
  `),

  /**
   * 32px square icon control. Concentric with the shell: its 12px radius less
   * the 4px gutter is 8px, so the button corner follows the curve it sits in.
   */
  ctl: trim(`
    relative inline-flex items-center justify-center shrink-0
    h-8 w-8 p-0 rounded-lg appearance-none border-none bg-transparent
    cursor-pointer touch-none outline-none
    transition-[background-color,color] duration-150 ease-out
    focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
    focus-visible:outline-(--ds-focus-color)
  `),

  /** Resting control: muted glyph, tonal fill on hover, one step darker on press. */
  ctlIdle: trim(`
    text-(--ds-gray-900)
    hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)
    active:bg-(--ds-gray-alpha-200)
  `),

  /** Selected control — Geist's inverted primary, monochrome by design. */
  ctlOn: trim(`
    bg-(--ds-gray-1000) text-(--ds-background-100)
    hover:bg-(--ds-gray-1000)/90
  `),

  /**
   * A compact 28px control, for the inside of a panel where a row is 36px tall
   * and a full 32px button would crowd it.
   */
  ctlSm: trim(`
    relative inline-flex items-center justify-center shrink-0
    h-7 w-7 p-0 rounded-md appearance-none border-none bg-transparent
    cursor-pointer outline-none
    transition-[background-color,color] duration-150 ease-out
    focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
    focus-visible:outline-(--ds-focus-color)
  `),

  /**
   * App bar. A hairline, never a shadow: a bar is welded to the page it sits on,
   * and a shadow under it would float it off a surface it belongs to.
   */
  bar: 'bg-(--ds-background-100) border-b border-(--ds-gray-alpha-400)',

  /**
   * Track for a set of mutually exclusive views. Selected reads as a panel
   * raised out of the track — the switcher case. A single on/off control uses
   * `ctlOn`'s inverted fill instead, so the two never blur together.
   */
  track: 'inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-(--ds-gray-alpha-100) shrink-0',

  /** One 28px view inside a `track`. */
  segment: trim(`
    relative inline-flex items-center justify-center shrink-0
    h-7 w-7 p-0 rounded-md appearance-none border-none bg-transparent
    cursor-pointer outline-none text-(--ds-gray-900)
    transition-[background-color,color,box-shadow] duration-150 ease-out
    hover:text-(--ds-gray-1000)
    focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
    focus-visible:outline-(--ds-focus-color)
    data-pressed:bg-(--ds-background-100) data-pressed:text-(--ds-gray-1000)
    data-pressed:[box-shadow:var(--ds-shadow-border-small)]
  `),

  /** A labelled view inside a `track` — same raised-panel selection, text width. */
  segmentText: trim(`
    relative inline-flex items-center justify-center shrink-0
    h-7 px-2.5 rounded-md appearance-none border-none bg-transparent
    cursor-pointer outline-none whitespace-nowrap
    text-ui font-medium text-(--ds-gray-900)
    transition-[background-color,color,box-shadow] duration-150 ease-out
    hover:text-(--ds-gray-1000)
    focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
    focus-visible:outline-(--ds-focus-color)
    data-pressed:bg-(--ds-background-100) data-pressed:text-(--ds-gray-1000)
    data-pressed:[box-shadow:var(--ds-shadow-border-small)]
  `),

  /** Text field. The border is the control — no fill change, no glow. */
  field: trim(`
    h-8 rounded-md bg-(--ds-background-100)
    border border-(--ds-gray-alpha-400)
    transition-[border-color] duration-150 ease-out
    focus-within:border-(--ds-gray-700)
  `),

  /** Input inside a `field` (or bare, for an inline-edit). */
  input: trim(`
    min-w-0 bg-transparent border-none outline-none
    text-ui text-(--ds-gray-1000) placeholder:text-(--ds-gray-700)
  `),

  /** Row of a panel or menu: 36px, full-bleed hover. */
  row: trim(`
    flex items-center justify-between gap-3 w-full h-9 px-4
    text-ui text-(--ds-gray-1000) text-left
    appearance-none bg-transparent border-none no-underline
  `),

  /** Interactive version of `row`. */
  rowHover: 'cursor-pointer transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)',

  /**
   * Section label inside a panel. Sentence case at row scale — the tracked-out
   * caps this replaces was the same costume on every small string in the app.
   */
  sectionLabel: 'text-meta font-medium text-(--ds-gray-900)',

  /** Secondary text: a value, a count, a section label. Sentence case, never caps. */
  meta: 'text-ui text-(--ds-gray-900)',

  /** Vertical rule between control groups. */
  sep: 'w-px h-5 mx-1 shrink-0 bg-(--ds-gray-alpha-400)',

  /** Horizontal rule between panel sections — full-bleed, flat, one hairline. */
  divider: 'h-px bg-(--ds-gray-alpha-400)',

  /**
   * A text action with no chrome — "Go to", "Resolve", "Remove". The reset only,
   * so it pairs with one of the two ramps below; `font-medium` stays at the call
   * site because the panel rows and the popover footers weight it differently.
   */
  bareBtn: 'text-meta bg-transparent border-none cursor-pointer p-0 transition-colors',

  /** Default ramp for a bare action. */
  bareBtnQuiet: 'text-(--ds-gray-900) hover:text-(--ds-gray-1000)',

  /** Destructive ramp — held under full strength until hover, so it never shouts at rest. */
  bareBtnDanger: 'text-(--ds-red-700)/70 hover:text-(--ds-red-700)',

  /**
   * The same action when it sits inside a row of content rather than alone in a
   * popover footer — "Resolve", "Remove". `bareBtn` is 12px of text with no box,
   * which under a comment reads as a caption and offers a 14px tap target; this
   * keeps the chrome-free rest state and adds a real 24px target and a fill to
   * answer the pointer. The negative margin holds the label on the same left
   * edge as the content above it, so the fill grows outward, not the text inward.
   * Geometry only — pair it with `ctlIdle` for the neutral ramp, which is the
   * one this app already uses for every other tonal-fill control.
   */
  actionBtn: trim(`
    inline-flex items-center h-6 px-1.5 -mx-1.5 rounded-md
    text-meta font-medium appearance-none border-none bg-transparent cursor-pointer
    outline-none transition-[background-color,color] duration-150 ease-out
    focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1
    focus-visible:outline-(--ds-focus-color)
    disabled:pointer-events-none disabled:opacity-50
  `),

  /**
   * Destructive ramp for an `actionBtn`. Neutral at rest, red on hover and focus:
   * the word "Remove" is the warning, and a red that is always on makes the one
   * thing nobody should click twice the most saturated object on the panel.
   */
  actionBtnDanger:
    'text-(--ds-gray-900) hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-red-700) focus-visible:text-(--ds-red-700)',

  /**
   * Shortcut chip inside a tooltip. `inline-flex` so a modifier glyph and its
   * letter sit centred on one axis rather than on the text baseline, which is
   * what let the two halves of `⇧H` drift apart optically.
   */
  kbd: trim(`
    inline-flex items-center gap-[0.15em]
    text-mini leading-none font-medium
    text-(--ds-gray-900) bg-(--ds-gray-alpha-200)
    rounded-sm px-1.5 py-1
  `),

  /**
   * Modifier glyphs (⌘ ⇧ ⌥ ⌃) inside a `kbd`. Every UI font draws them lighter
   * and shorter than a cap, so at the chip's own size `⇧H` reads as one cramped
   * mark instead of two keys. A size bump matches the letter's optical weight;
   * the chip's gap supplies the air between them.
   */
  kbdModifier: 'text-ui leading-none',
} as const;
