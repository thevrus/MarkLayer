/**
 * Shared form-control class recipes.
 *
 * Companion to `glass.ts`. Each export is a Tailwind class string consumed via
 * `class={cn(submitBtn, '...overrides')}`. The accent gradient/shadow stops
 * live here so the popovers (extension + worker) stay in sync.
 */

const trim = (s: string) => s.replace(/\n\s+/g, ' ').trim();

/** Primary action button — purple gradient, white text. Used for "Post", "Save", "Comment". */
export const submitBtn = trim(`
  px-4 py-1.5 text-[12px] font-semibold rounded-[10px] border-none cursor-pointer
  bg-linear-to-b from-[oklch(0.68_0.15_300)] to-[oklch(0.58_0.15_300)]
  text-white outline-none
  shadow-[inset_0_1px_0_oklch(1_0_0/0.15),0_1px_3px_oklch(0_0_0/0.2)]
  transition-[box-shadow,transform] duration-150
  hover:from-[oklch(0.72_0.15_300)] hover:to-[oklch(0.62_0.15_300)]
  hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_2px_16px_oklch(0.65_0.15_300/0.2)]
  focus-visible:shadow-[inset_0_1px_0_oklch(1_0_0/0.2),0_0_0_3px_oklch(0.65_0.15_300/0.35)]
  active:scale-[0.96]
`);

/** Secondary outline button — used as paired siblings (Add to stack / Copy). Layout flex is caller-supplied. */
export const secondaryBtn = trim(`
  inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-[10px]
  cursor-pointer whitespace-nowrap
  bg-ml-glass-fg/6 text-ml-glass-fg/85 border border-ml-glass-fg/15
  transition-[background-color,border-color,color,transform] duration-150
  hover:bg-ml-glass-fg/10 hover:text-ml-glass-fg hover:border-ml-glass-fg/25
  active:scale-[0.96]
`);

/** Textarea — accent caret, accent focus ring, glass-tinted background. Caller adds w-full + min/max-h overrides. */
export const textareaCls = trim(`
  bg-ml-glass-fg/4 border border-ml-glass-fg/12 rounded-xl px-3.5 py-2.5
  text-ml-glass-fg text-[13.5px] leading-relaxed
  resize-none outline-none
  caret-ml-accent
  transition-[border-color,background-color,box-shadow] duration-150
  focus:border-ml-accent/50
  focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-ml-accent)_12%,transparent),inset_0_0.5px_0_oklch(1_0_0/0.04)]
  focus:bg-ml-glass-fg/6
  placeholder:text-ml-glass-fg/45
`);
