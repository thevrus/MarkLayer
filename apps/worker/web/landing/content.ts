import { HOW_IT_WORKS_PATH } from '@ext/lib/share';

/**
 * The three claims named under the review board.
 *
 * Text only: the visuals all live in one artifact now (see ReviewBoard) rather
 * than being restated as three small objects beside three paragraphs.
 */
export const MOMENTS: { title: string; desc: string }[] = [
  {
    title: 'Send one link.',
    desc: 'Whoever opens it can read the page and comment on it in their own browser. No account, nothing to install.',
  },
  {
    title: 'Watch it happen.',
    desc: 'Cursors, strokes and replies land for everyone at once, so a review is a conversation, not a queue of screenshots.',
  },
  {
    title: 'It stays put.',
    desc: 'Threads anchor to the element they were left on, so they survive a deploy, a reflow and a different screen size.',
  },
];

/**
 * The nav's links. The page shipped with a logo, two icon links and no
 * navigation at all, while the footer carried twenty — so the only way into the
 * comparison and use-case pages was to scroll past everything first.
 */
export const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'How it works', href: HOW_IT_WORKS_PATH },
  { label: 'Compare', href: '/compare' },
  { label: 'Use cases', href: '/use-cases' },
  { label: 'Pricing', href: '/pricing' },
];

/**
 * The one seeded annotation on the board.
 *
 * A fixed id rather than a nanoid, so a re-mount can never stack a second copy
 * of it. The landing never calls `restoreDraft`, so every load starts from an
 * empty op list and this is the only thing on the board until a visitor draws.
 *
 * It is a real CommentOp on the real op stream: the pin it renders is
 * WebCommentPin, clicking it opens the actual thread, and replying, resolving
 * or deleting it all work exactly as they do on a shared page. The page claims
 * to be a live board one line above the toolbar; this is the claim being true
 * rather than asserted.
 */
export const HERO_PIN_ID = 'ml-hero-pin';

export const CTA_CLS =
  'lp-cta inline-flex items-center gap-2 h-12 px-7 rounded-full text-white text-body font-medium no-underline transition-colors select-none';
