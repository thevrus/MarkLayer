/**
 * Everything about this email that is not JSX. See sign-in.meta.ts for why
 * this is kept apart from invite.tsx.
 */
export const id = 'invite';

export const subject = 'Someone invited you to an annotation on MarkLayer';

/** Substituted at send time. Build-time rendering means no data is available yet. */
export const PLACEHOLDER = { link: '{{link}}' } as const;

export const text = [
  "You've been invited to view an annotation",
  '',
  'Open this address to see it:',
  PLACEHOLDER.link,
  '',
  "If you weren't expecting this, ignore this email. Nothing will happen.",
  '',
  'MarkLayer · marklayer.app',
].join('\n');
