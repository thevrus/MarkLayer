import { HOW_IT_WORKS_PATH } from '@ext/lib/share';
import { Eye, FileDown, Files, type LucideIcon, MonitorPlay, Ruler, Send, SquareKanban, Video } from 'lucide-preact';

/**
 * The three claims named under the demo, each set as a bold lead-in that runs
 * on into its sentence. Text only: the visual is the live board above them.
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

/** What an agent does once it is in the room, in the same lead-in form as MOMENTS. */
export const AGENT_MOMENTS: { title: string; desc: string }[] = [
  {
    title: 'It gets the element.',
    desc: 'A comment pinned to an element reaches the agent with its selector and a markdown snapshot. Screenshots come as links.',
  },
  {
    title: 'You watch it work.',
    desc: 'Acknowledged, replied, resolved. Every status change lands on the page while the thread is still in front of you.',
  },
  {
    title: 'Copy fixes arrive as diffs.',
    desc: 'A typo or grammar fix comes back as the exact replacement, not a paragraph describing it.',
  },
];

/** The agents whose marks the product already draws when they join a room. */
export const AGENT_IDS = ['claude', 'cursor', 'copilot', 'windsurf', 'cline', 'zed', 'gemini'] as const;

/**
 * The rest of the product, one line each. Eight, so the grid closes on a full
 * row at two columns and at four.
 */
export const FEATURES: { title: string; desc: string; icon: LucideIcon }[] = [
  { title: 'Voice and video.', desc: 'Talk it through in the room. Nobody installs anything to join.', icon: Video },
  {
    title: 'Present and follow.',
    desc: 'Pull everyone to your scroll position, or ride along on someone else’s.',
    icon: MonitorPlay,
  },
  {
    title: 'Status and priority.',
    desc: 'Five statuses and four priorities, with a board to triage them on.',
    icon: SquareKanban,
  },
  {
    title: 'Measure and guides.',
    desc: 'Hold Alt for pixel distances, as in Figma, and pin ruler guides to the page.',
    icon: Ruler,
  },
  { title: 'Up to 50 pages.', desc: 'Review a whole flow on one link, switched through tabs.', icon: Files },
  {
    title: 'Out to your tools.',
    desc: 'Batches post to Slack, Teams or Discord. A single comment files as a Linear, GitHub or Jira issue.',
    icon: Send,
  },
  {
    title: 'Markdown export.',
    desc: 'Every comment, reply and suggested edit in one document, copied or downloaded.',
    icon: FileDown,
  },
  {
    title: 'View-only links.',
    desc: 'Optional email sign-in lets you lock a link to view-only, set when it expires and see every link you own.',
    icon: Eye,
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

/** The four tools the alternatives heading names, each linked to its head-to-head page. */
export const COMPARISONS: { name: string; href: string }[] = [
  { name: 'BugHerd', href: '/vs/bugherd' },
  { name: 'Marker.io', href: '/vs/marker-io' },
  { name: 'Pastel', href: '/vs/pastel' },
  { name: 'Markup.io', href: '/vs/markup-io' },
];
/** The heading names exactly the tools the section links. */
export const COMPARISON_NAMES = new Intl.ListFormat('en', { type: 'conjunction' }).format(
  COMPARISONS.map((c) => c.name),
);

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Does the other person need the extension installed?',
    a: 'No. Anyone can view your annotations via the share link. No install required.',
  },
  { q: 'Is it really free?', a: 'Yes. No account, no paywall, no trial period.' },
  {
    q: 'Does it work on any website?',
    a: 'Yes. Production, staging, internal tools, localhost, third-party pages.',
  },
  {
    q: 'Does it work on localhost?',
    a: 'Yes, with the Chrome extension. It draws in your browser, so your dev server never has to be reachable from the internet. Share links do need a public URL, so point collaborators at staging or a tunnel.',
  },
  {
    q: 'Can multiple people annotate at the same time?',
    a: 'Yes. Everyone sees each other’s cursors and marks as they happen, and you can talk over voice or video in the same room.',
  },
  {
    q: 'Can I keep a link private?',
    a: 'Links are unguessable and unlisted. If you sign in with an email link (optional), you can make one view-only or set when it expires.',
  },
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
  'lp-cta inline-flex items-center gap-2 h-12 px-7 rounded-full text-white text-body no-underline whitespace-nowrap transition-colors';
