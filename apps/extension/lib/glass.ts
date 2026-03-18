/** Shared liquid-glass surface tokens (macOS Sequoia-inspired) as Tailwind classes */

export const glass = {
  /** Primary surface — toolbar, popover panels.
   *  Ultra-transparent with strong blur for liquid glass effect. */
  surface: `
    bg-[oklch(0.13_0.012_280/0.82)]
    backdrop-blur-[80px] backdrop-saturate-[1.9] backdrop-brightness-[1.1]
    border border-white/[0.18]
    shadow-[0_0_0_0.5px_oklch(0_0_0/0.35),0_8px_40px_oklch(0_0_0/0.3),0_24px_60px_oklch(0_0_0/0.18),inset_0_1px_0_oklch(1_0_0/0.18),inset_0_-0.5px_0_oklch(0_0_0/0.1)]
    rounded-[22px]
  `
    .replace(/\n\s+/g, ' ')
    .trim(),

  /** Smaller floating surface — tooltips, hover cards */
  surfaceSmall: `
    bg-[oklch(0.12_0.012_280/0.85)]
    backdrop-blur-[72px] backdrop-saturate-[1.7] backdrop-brightness-[1.1]
    border border-white/[0.15]
    shadow-[0_0_0_0.5px_oklch(0_0_0/0.3),0_6px_24px_oklch(0_0_0/0.25),0_16px_48px_oklch(0_0_0/0.15),inset_0_0.5px_0_oklch(1_0_0/0.15)]
    rounded-2xl
  `
    .replace(/\n\s+/g, ' ')
    .trim(),

  /** Divider line */
  divider: 'h-px bg-gradient-to-r from-transparent via-white/[0.1] to-transparent',

  /** Vertical separator */
  sep: 'w-px h-6 bg-gradient-to-b from-transparent via-white/[0.12] to-transparent shrink-0 mx-1.5',

  /** Font stack */
  font: "font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','Inter',system-ui,sans-serif]",
} as const;
