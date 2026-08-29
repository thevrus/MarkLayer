/**
 * Shared form-control class recipes.
 *
 * Companion to `geist.ts` — same Geist language, and the same `--ds-*` tokens.
 * Each export is a Tailwind class string consumed via
 * `class={cn(submitBtn, '...overrides')}`, so the popovers (extension + worker)
 * stay in sync from one place.
 */

/** Collapse a multi-line class recipe to one line. Shared with `glass.ts` and `geist.ts`. */
export const trim = (s: string) => s.replace(/\n\s+/g, ' ').trim();

/**
 * Primary action — "Post", "Save", "Comment". Geist's inverted primary: the ink
 * colour becomes the fill, so the strongest control on a surface is the one with
 * the most contrast rather than the most colour.
 */
export const submitBtn = trim(`
  inline-flex items-center justify-center gap-1.5 h-8 px-3 whitespace-nowrap
  text-ui font-medium rounded-md border-none cursor-pointer outline-none
  bg-(--ds-gray-1000) text-(--ds-background-100)
  transition-[background-color] duration-150 ease-out
  hover:bg-(--ds-gray-1000)/90
  focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2
  focus-visible:outline-(--ds-focus-color)
`);

/** Secondary action — the same shape, carried by its border instead of a fill. */
export const secondaryBtn = trim(`
  inline-flex items-center justify-center gap-1.5 h-8 px-3 whitespace-nowrap
  text-ui font-medium rounded-md cursor-pointer outline-none
  bg-(--ds-background-100) text-(--ds-gray-1000) border border-(--ds-gray-alpha-400)
  transition-[background-color,border-color] duration-150 ease-out
  hover:bg-(--ds-gray-alpha-100) hover:border-(--ds-gray-700)
  focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2
  focus-visible:outline-(--ds-focus-color)
`);

/**
 * Textarea. The border is the control: it steps one value on focus and nothing
 * glows. Caller adds w-full + min/max-h overrides.
 *
 * 13px is deliberate: the usual "16px or iOS zooms the page" rule has no purchase
 * here, since both consumers are desktop-only — the extension is a Chrome content
 * script, and the web viewer blocks itself below `md`.
 */
export const textareaCls = trim(`
  bg-(--ds-background-100) border border-(--ds-gray-alpha-400) rounded-md px-3 py-2
  text-(--ds-gray-1000) text-ui leading-relaxed
  resize-none outline-none caret-(--ds-gray-1000)
  transition-[border-color] duration-150 ease-out
  focus:border-(--ds-gray-700)
  placeholder:text-(--ds-gray-700)
`);
