/**
 * Everything about this email that is not JSX.
 *
 * Kept apart from `sign-in.tsx` deliberately: the Worker imports this file and
 * the generated HTML, and must never reach a module that imports React. That
 * separation is the only thing keeping React out of the Worker bundle.
 */
export const id = 'sign-in';

export const subject = 'Your MarkLayer sign-in link';

/** Substituted at send time. Build-time rendering means no data is available yet. */
export const PLACEHOLDER = { link: '{{link}}' } as const;

export const text = [
  'Sign in to MarkLayer',
  '',
  'Open this address to sign in. It works once and expires in 15 minutes.',
  PLACEHOLDER.link,
  '',
  'If you did not ask to sign in, ignore this email. Nothing will happen.',
  '',
  'MarkLayer · marklayer.app',
].join('\n');
