/** Shared by the extension and the web app (via `@ext/*`) — one definition of "skip the motion". */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
