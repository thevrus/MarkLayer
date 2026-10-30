import { CommentPopover } from '@ext/components/CommentPopover';
import { InspectorLayer } from '@ext/components/InspectorLayer';
import { Toasts } from '@ext/components/Toasts';
import { Toolbar } from '@ext/components/Toolbar';
import { AgentMark } from '@ext/lib/agents';
import { activeTool, color, comments as commentsComputed, isDrawingTool, lineWidth, selections } from '@ext/lib/state';
import type { TextOp } from '@ext/lib/types';
import { agentLabel, cn } from '@marklayer/types';
import copy from '@site/data/home-copy.json';
import { ASK_AI, ASK_AI_LABEL, COLOPHON, FOOTER_COLUMNS, TRADEMARK_NOTICE } from '@site/lib/footer';
import { CHROME_STORE_URL } from '@site/lib/site';
import { ArrowUpRight, ChevronDown } from 'lucide-preact';
import { nanoid } from 'nanoid';
import type { ComponentChildren, JSX } from 'preact';
import { siProducthunt } from 'simple-icons';
import { capture } from './analytics';
import { ChannelCycle } from './ChannelCycle';
import { FakeCursors } from './FakeCursors';
import { frameViewport } from './iframeOverlay';
import { ChromeIcon, ChromeStoreLink } from './landing/ChromeStoreLink';
import { AGENT_IDS, AGENT_MOMENTS, COMPARISON_NAMES, COMPARISONS, FAQ, FEATURES, NAV_LINKS } from './landing/content';
import { DemoStage } from './landing/DemoStage';
import { FEATURE_ARTS } from './landing/FeatureArts';
import { HeroSource } from './landing/HeroSource';
import { McpCommand } from './landing/McpCommand';
import { AgentRow, Art, Caption, Card, MarginNote, ProblemRow, ProofGrid } from './landing/Proof';
import { useLandingCanvas } from './landing/useLandingCanvas';
import { useLandingPresence } from './landing/useLandingPresence';
import { useLandingShortcuts } from './landing/useLandingShortcuts';
import { GithubLink, ICON_LINK_CLS, Logo, TextInputOverlay } from './shared';
import { commentPopover, embedInView, isMobileDevice, pushDeviceOp, selectionPopover, textInput } from './signals';
import { STATUS_LABEL, systemStatus } from './status';
import { WebCommentPin } from './WebCommentPin';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

/* One display step for every section head and one reading step for every
   paragraph, so no section sets its own scale. */
const HEAD_CLS = 'lp-display mx-auto max-w-[18em] text-center text-statement text-balance text-ml-fg';
const BODY_CLS = 'm-0 text-lede leading-prose text-ml-fg/60';

/** A section head: the claim in the serif, its support on its own line under it in grey. */
function SectionHead({ title, children }: { title: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="text-center">
      <h2 class={HEAD_CLS}>{title}</h2>
      {children && <p class="mx-auto mt-4 max-w-[46ch] text-intro text-balance text-ml-fg/55">{children}</p>}
    </div>
  );
}

/** One feature: the claim, a line of support, and the piece of the product it rests on. */
function FeatureCard({ title, desc, art: ArtBody }: { title: string; desc: string; art: () => JSX.Element }) {
  return (
    <Card>
      <Caption title={title}>{desc}</Caption>
      {/* Anchored to the top and cut by the card's bottom edge, so a demo taller than its slot is cropped, not squeezed. */}
      <Art class="h-[250px] justify-start pb-0">
        <ArtBody />
      </Art>
    </Card>
  );
}

/* The rhythm: every section opens with the same space above its head, and a
   head sits one step above the cards it introduces. */
const SECTION_CLS = 'relative pt-28 sm:pt-36';
const CARDS_CLS = 'mt-12 sm:mt-14';

/**
 * The marketing page, which is also a live board: every mark on the first screen
 * is a real op on the real op stream, drawn with the product's own canvas and
 * toolbar.
 *
 * The behaviour that makes that true lives in `./landing` — the drawing engine,
 * the keyboard layer, the seeded pin, uploads and presence each as one hook — so
 * what is left here is the composition. It was one 1,277-line component with all
 * six concerns interleaved above the JSX.
 */
export function Landing() {
  const { canvasRef, onDown } = useLandingCanvas();
  useLandingShortcuts();
  useLandingPresence();

  const tool = activeTool.value;
  const showCanvas = isDrawingTool(tool) && tool !== 'comment' && tool !== 'text' && tool !== 'selection';
  const showTextCursor = tool === 'text';
  const showCommentCursor = tool === 'comment';
  const comments = commentsComputed.value;

  return (
    <>
      {/* The board. Every mark on the first screen is real: the canvas, the
          toolbar and the strokes are the product's own, on its real op stream. */}
      <div class="ml-force-light lp-voice relative min-h-screen overflow-x-clip lp-board">
        {/* Glass, sticky, and on the frame's rails: the wordmark starts on the
            left rail and the install button ends on the right one. */}
        <header class="lp-nav sticky top-0 z-2147483647" data-away={embedInView.value ? 'true' : undefined}>
          <nav class="mx-auto flex h-14 w-full max-w-page items-center justify-between gap-6 px-6 sm:px-10">
            <a href="/" class="flex items-center gap-2 no-underline">
              <Logo size={26} />
              <span class="font-ui text-lede font-semibold tracking-brand text-ml-fg">MarkLayer</span>
            </a>
            <div class="flex items-center gap-0.5 sm:gap-1">
              <div class="mr-1 hidden items-center sm:flex">
                {NAV_LINKS.map(({ label, href }) => (
                  <a
                    key={href}
                    href={href}
                    class="whitespace-nowrap px-3 py-1.5 text-ui-lg text-ml-fg/60 no-underline transition-colors hover:text-ml-fg"
                  >
                    {label}
                  </a>
                ))}
              </div>
              <a
                href="https://www.producthunt.com/posts/marklayer"
                target="_blank"
                rel="noopener"
                class={cn(ICON_LINK_CLS, 'text-ml-fg/60 hover:text-ml-fg')}
              >
                <span class="sr-only">Product Hunt</span>
                <svg class="size-[18px] fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={siProducthunt.path} />
                </svg>
              </a>
              <GithubLink dark />
              {!isMobileDevice && (
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener"
                  class="lp-cta ml-2 hidden h-8 items-center whitespace-nowrap rounded-lg px-3 text-ui font-medium text-white no-underline transition-colors lg:inline-flex"
                  onClick={() => capture('extension_install_clicked', { at: 'nav' })}
                >
                  Add to Chrome
                </a>
              )}
            </div>
          </nav>
        </header>

        <main>
          <div class="mx-auto w-full max-w-page px-6 sm:px-10">
            {/* The hero owns the fold: nav plus this section is exactly one screen. */}
            <section class="relative isolate flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center pt-16 pb-20 text-center sm:pt-10 sm:pb-40">
              <div class="lp-dots -z-1" aria-hidden="true" />
              {/* The demo cursors belong to the fold and scroll away with it. */}
              <FakeCursors />

              {/* Two explicit lines, no `text-balance`: only line two holds the
                  cycling word, so the block's height never changes as it swaps. */}
              <h1 class="lp-display lp-fade-up text-hero text-ml-fg" style={{ animationDelay: '0.05s' }}>
                <span class="block">{copy.headlinePrefix}</span>
                <span class="block">
                  {copy.headlineJoiner} <ChannelCycle /> {copy.headlineSuffix}
                </span>
              </h1>

              <p
                class="lp-fade-up mt-6 max-w-[48ch] text-intro text-ml-fg/60 text-balance"
                style={{ animationDelay: '0.1s' }}
              >
                Send one link. Your client comments on the live page. Nothing to install, no account.
              </p>

              {/* Pasting a URL delivers the product in one step; the install
                      is the higher-friction ask, so it sits in the nav. */}
              <HeroSource />

              {/* Verifiable claims only: the licence link goes to the repo. */}
              <p
                class="lp-fade-up mt-9 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-ui text-ml-fg/60"
                style={{ animationDelay: '0.25s' }}
              >
                {/* Below `lg` the nav has no room for its install button, so the fold keeps one. */}
                {/* A phone browser can't install an extension, so it isn't offered one. */}
                {!isMobileDevice && (
                  <>
                    <a
                      href={CHROME_STORE_URL}
                      target="_blank"
                      rel="noopener"
                      class="inline-flex items-center gap-1.5 text-ml-fg/60 no-underline transition-colors hover:text-ml-fg lg:hidden"
                      onClick={() => capture('extension_install_clicked', { at: 'hero' })}
                    >
                      <ChromeIcon />
                      Add to Chrome
                    </a>
                    <span aria-hidden="true" class="lg:hidden">
                      ·
                    </span>
                  </>
                )}
                <span>No account needed</span>
                <span aria-hidden="true">·</span>
                <a
                  href="https://github.com/thevrus/MarkLayer"
                  target="_blank"
                  rel="noopener"
                  class="text-ml-fg/60 hover:text-ml-fg transition-colors underline underline-offset-2 decoration-ml-fg/30"
                >
                  Apache-2.0
                </a>
                <span aria-hidden="true">·</span>
                <span>Self-hostable</span>
              </p>

              {/* Without this line, strangers' cursors over the copy read as a
                  rendering fault. Sits above the docked toolbar, on its centre line. */}
              <div
                class="lp-fade-up pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center px-6 sm:flex sm:bottom-27"
                style={{ animationDelay: '0.3s' }}
              >
                <p class="m-0 text-ui text-ml-fg/60">
                  This page is a live board. <span class="text-ml-fg">Pick a tool below and draw.</span>
                </p>
              </div>
            </section>

            {/* The problem first, in the reader's own terms: the gate a client
                meets, and where the feedback ends up instead. */}
            <section class={SECTION_CLS}>
              <MarginNote class="top-[22%] left-[2%]">Been here?</MarginNote>
              <SectionHead title="Clients won’t install anything to say a button is wrong.">
                So it arrives by email, and nobody knows which button.
              </SectionHead>
              <div class={CARDS_CLS}>
                <ProblemRow />
              </div>
            </section>

            {/* The proof: the real viewer on a shared room, which scroll grows to
                the whole screen, then the claims each proved by a piece of the product. */}
            <section class={SECTION_CLS}>
              <MarginNote class="top-[22%] right-[2%]" flip>
                The whole fix
              </MarginNote>
              <SectionHead title="One link is the whole setup.">
                They open it and comment on the page. Nothing to install on either end.
              </SectionHead>
              <div class={CARDS_CLS}>
                <DemoStage />
              </div>
              <div class="mt-16 sm:mt-20">
                <ProofGrid />
              </div>
            </section>

            {/* The agent handoff. The command is the install, not a room: pointing a visitor's
                agent at the public demo board would feed it strangers' comments. */}
            <section class={cn(SECTION_CLS, 'text-center')}>
              {/* The one inverted surface on the page: the agent's room, where the human is not. */}
              <div class="lp-dark rounded-3xl px-6 py-16 sm:px-10 sm:py-24">
                <SectionHead title="Let your AI coding tool make the fixes.">
                  Give Claude Code or Cursor the link. It reads each comment, fixes the code and ticks it off.
                </SectionHead>
                <div class="mt-12">
                  <McpCommand />
                </div>
                <p class="mt-5 text-ui text-ml-fg/60">
                  No install needed: add <code class="font-mono">/mcp</code> to any share link.
                </p>
                <div class="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-ui text-ml-fg/60">
                  <span id="lp-agents" class="text-ml-fg">
                    Works with
                  </span>
                  <ul
                    aria-labelledby="lp-agents"
                    class="m-0 flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-3 p-0"
                  >
                    {AGENT_IDS.map((id) => (
                      <li key={id} class="m-0 inline-flex items-center gap-1.5 p-0">
                        <AgentMark id={id} size={15} />
                        {agentLabel(id)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div class={cn(CARDS_CLS, 'text-left')}>
                <AgentRow moments={AGENT_MOMENTS} />
              </div>
            </section>

            <section class={SECTION_CLS}>
              <SectionHead title="Everything else a review needs.">
                All free. Full list on the{' '}
                <a href="/features" class="text-ml-fg underline underline-offset-2 decoration-ml-fg/30">
                  features page
                </a>
                .
              </SectionHead>
              {/* Two columns, alternating wide and narrow, so the pile reads as a pile and not a grid of equals. */}
              <div class={cn(CARDS_CLS, 'grid gap-4 md:grid-cols-5 sm:gap-5')}>
                {FEATURES.map((f, i) => (
                  <div key={f.title} class={cn('grid', [0, 3].includes(i % 4) ? 'md:col-span-3' : 'md:col-span-2')}>
                    <FeatureCard {...f} art={FEATURE_ARTS[i] ?? FEATURE_ARTS[0]} />
                  </div>
                ))}
              </div>
            </section>

            <section class={SECTION_CLS}>
              <SectionHead
                title={
                  <>
                    Free alternative <span class="text-ml-fg/50">to {COMPARISON_NAMES}.</span>
                  </>
                }
              />
              {/* The pricing claims live in home-copy.json, shared with HomeContent.astro. */}
              <div class="mx-auto mt-12 grid max-w-[960px] gap-x-14 gap-y-5 md:grid-cols-2">
                <p class={cn(BODY_CLS, 'text-pretty')}>{copy.pricingFacts}</p>
                <p class={cn(BODY_CLS, 'text-pretty')}>
                  MarkLayer is free by licence (Apache-2.0), not by a pricing policy that can change. Self-host it if
                  you want.{' '}
                  <a
                    href="/guides/free-website-annotation-tools"
                    class="text-ml-fg underline underline-offset-2 decoration-ml-fg/30"
                  >
                    See the full audit
                  </a>
                  , checked against live pricing pages.
                </p>
              </div>
              <p class="mx-auto mt-10 max-w-[62ch] text-center text-ui leading-prose text-balance text-ml-fg/60">
                More:{' '}
                <a href="/compare" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                  all comparisons
                </a>
                {' · '}
                <a href="/alternatives" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                  alternatives by tool
                </a>
                {' · '}
                <a href="/alternatives/markup-io" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                  Markup.io alternatives by price
                </a>
                {' · '}
                <a href="/for/staging-feedback-no-extension" class="text-ml-fg/60 underline hover:text-ml-fg/80">
                  staging feedback without an extension
                </a>
              </p>

              {/* One row of head-to-heads, each its own link card. */}
              <nav aria-label="Comparisons" class={cn(CARDS_CLS, 'grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5')}>
                {COMPARISONS.map(({ name, href }) => (
                  <a
                    key={href}
                    href={href}
                    class="lp-card relative flex flex-col gap-1 px-5 py-5 no-underline sm:px-6 sm:py-6"
                  >
                    <span class="text-ui text-ml-fg/60">MarkLayer vs</span>
                    <span class="font-ui text-lede font-semibold tracking-ui text-ml-fg">{name}</span>
                    <ArrowUpRight
                      size={16}
                      class="lp-compare-arrow absolute top-5.5 right-5 text-ml-fg/50 sm:top-6.5 sm:right-6"
                      aria-hidden="true"
                    />
                  </a>
                ))}
              </nav>
            </section>

            {/* The head on the left, the questions on the right: a list, not a card. */}
            <section class={cn(SECTION_CLS, 'lp-faq mx-auto grid max-w-[1000px] gap-10 md:grid-cols-[1fr_2fr]')}>
              <h2 class={cn(HEAD_CLS, 'mx-0 text-left')}>Questions</h2>
              <div class="divide-y divide-ml-rule">
                {FAQ.map((item) => (
                  <details key={item.q}>
                    <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 py-4 text-lede text-ml-fg">
                      {item.q}
                      <ChevronDown class="lp-faq-mark shrink-0 text-ml-fg/60" size={16} strokeWidth={1.5} />
                    </summary>
                    <p class={cn(BODY_CLS, 'max-w-[62ch] pb-5 text-pretty')}>{item.a}</p>
                  </details>
                ))}
              </div>
            </section>

            {/* The close, and the only full-size install button on the page. It
                takes the hero's step, so the page ends at the size it opened at. */}
            <section class="pt-28 pb-16 text-center sm:pt-36 sm:pb-20">
              <h2 class="lp-display mx-auto mb-10 max-w-[14em] text-hero text-balance text-ml-fg">
                Get feedback on the page, not in your inbox.
              </h2>
              <ChromeStoreLink label="Add to Chrome" at="closing" />
              <p class="mt-4 text-ui text-ml-fg/60">Free &middot; No sign-up</p>
            </section>
          </div>

          {/* The same footer the marketing pages close with (SiteFooter.astro),
              read from `@site/lib/footer`, on the page's own floor. */}
          <footer class="@container relative overflow-hidden pt-16 pb-7">
            <div class="mx-auto w-full max-w-page px-6 sm:px-10">
              {/* A grid, not `flex-wrap`: wrapping drops the fourth column onto
                  its own row as soon as the links grow, leaving three columns
                  and an orphan off the shared baseline. */}
              <div class="grid grid-cols-2 gap-x-8 gap-y-9 text-ui sm:grid-cols-[1.4fr_repeat(4,1fr)]">
                <div class="col-span-2 sm:col-span-1">
                  <a href="/" class="inline-flex items-center gap-2 no-underline">
                    <Logo size={22} />
                    <span class="font-ui text-body font-semibold tracking-brand text-ml-fg">MarkLayer</span>
                  </a>
                  <p class="m-0 mt-3 max-w-[24ch] text-ui leading-prose text-ml-fg/60">
                    Feedback on the live page. Free, open source, nothing to install.
                  </p>
                </div>
                {FOOTER_COLUMNS.map((col) => (
                  <div key={col.heading}>
                    <p class="m-0 mb-3 text-ui font-semibold tracking-label text-ml-fg">{col.heading}</p>
                    <ul class="m-0 list-none space-y-0.5 p-0">
                      {col.links.map((l) => (
                        <li key={l.href} class="m-0 p-0">
                          <a
                            href={l.href}
                            target={l.external ? '_blank' : undefined}
                            rel={l.external ? 'noopener noreferrer' : undefined}
                            class="inline-flex min-h-9 items-center text-ml-fg/70 no-underline transition-colors duration-150 pointer-coarse:min-h-11 hover:text-ml-fg"
                          >
                            {l.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* The assistant marks, laid out as a fifth column turned on its
                  side — the label takes the same quiet step as the four
                  headings above, so it reads as part of the footer rather than
                  a widget bolted under it. `-mx-2` cancels the first and last
                  marks' hit-area padding, so the row's optical gaps match the
                  gap utility instead of running 8px wide at each end. */}
              <div class="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p class="m-0 text-ui text-ml-fg/65">{ASK_AI_LABEL}</p>
                <ul class="-mx-2 m-0 flex list-none flex-wrap items-center p-0">
                  {ASK_AI.map((a) => (
                    <li key={a.label} class="m-0 p-0">
                      <a
                        href={a.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Ask ${a.label} about MarkLayer`}
                        class="inline-flex items-center justify-center rounded-md p-2 text-ml-fg/60 no-underline transition-colors duration-150 pointer-coarse:size-11 pointer-coarse:p-0 hover:text-ml-fg"
                      >
                        {/* An sr-only label rather than `aria-label`, the same
                            way every other bare mark on the site is named: it
                            survives translation and a stripped attribute, and
                            it is what the header's GitHub mark already does. */}
                        <span class="sr-only">Ask {a.label} about MarkLayer</span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          fill-rule="evenodd"
                          aria-hidden="true"
                        >
                          <path d={a.path} />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The two closing lines are one tier of fine print: a step
                  smaller and quieter than the link columns, so the legal
                  boilerplate is not the heaviest text on the floor. */}
              <p class="mt-10 mb-0 text-fine text-ml-fg/65">{TRADEMARK_NOTICE}</p>
              {/* The closing row: the colophon on the page's spine, where the
                  lockup belongs, and the status line anchored to the opposite
                  end. Two items on one line rather than a third stacked grey
                  line. `items-center`, not `items-baseline`: the colophon is
                  itself a flex row led by the mark, so its first baseline is
                  the mark's bottom edge rather than the text's, and baseline
                  alignment dropped the status 5px below the line it sits on.

                  The reference for this row put the status on the left; it is
                  on the right here because the left edge of the floor is the
                  brand's edge. Mirrored in SiteFooter.astro. */}
              <div class="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
                <p class="m-0 flex items-start gap-2 text-fine text-ml-fg/65">
                  {/* Aligned to the FIRST line, not to the block: the line
                      wraps on a phone, and a centred mark then floats between
                      the two rows. */}
                  <Logo size={14} class="mt-[3px] shrink-0" />
                  <span>
                    &copy; {new Date().getFullYear()} MarkLayer &middot; {COLOPHON}
                  </span>
                </p>
                {/* Starts at `ok`, which is what the page attests — it came
                    from the Worker that answers `/api/health` — and downgrades
                    only on a probe that measured D1 or R2 not answering. When it
                    does, the green and the breath both go: grey and still
                    against green and breathing is the whole signal, so it needs
                    no second colour. */}
                <p class="ml-live" data-ml-status={systemStatus.value} role="status">
                  {/* The pulse rides the mark only — see `mlLivePulse` in
                      style.css for why it breathes rather than ringing, and why
                      the dot is fully rendered if the animation never runs. */}
                  <span class="ml-live-dot" aria-hidden="true" />
                  {STATUS_LABEL[systemStatus.value]}
                </p>
              </div>
            </div>
          </footer>
        </main>

        {/* Comment overlay.

            Absolute, spanning the document, with `scrollY` held at 0 — the same
            way the canvas below positions its ops. These layers used to be
            `fixed` and were handed `window.scrollY` read once during render;
            nothing re-renders them on scroll, so the subtraction went stale the
            moment the page moved and every pin sat frozen at a viewport offset,
            drifting across the sections below it. Document coordinates on a
            document-height layer need no scroll arithmetic at all, so there is
            nothing left to go stale. */}
        <div
          class="absolute inset-0 z-2147483646 overflow-hidden"
          style={{
            pointerEvents: showCommentCursor ? 'auto' : 'none',
            cursor: showCommentCursor ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (tool !== 'comment') return;
            commentPopover.value = { x: e.clientX, y: e.clientY + (window.scrollY || 0) };
          }}
        >
          {comments.map((c) => (
            <WebCommentPin key={c.id} op={c} scale={1} scrollY={0} />
          ))}
          {commentPopover.value && (
            <CommentPopover
              at={{ x: commentPopover.value.x, y: commentPopover.value.y }}
              anchorAt={{ x: commentPopover.value.x, y: commentPopover.value.y }}
              capture={() => ({ captureViewport: frameViewport(null) })}
              push={pushDeviceOp}
              onClose={() => {
                commentPopover.value = null;
              }}
            />
          )}
        </div>

        {/* Selection highlights. A hovered or held card steps up to the comment
            layer's z and wins on DOM order, or the pins and canvas cover it. */}
        <div
          class="absolute inset-0 z-2147483645 pointer-events-none overflow-hidden
                 has-[[data-marker]:hover]:z-2147483646 has-[[data-held]]:z-2147483646"
        >
          {selections.value.map((op) => (
            <WebSelectionHighlight key={op.id} op={op} scale={1} scrollY={0} />
          ))}
        </div>
        {selectionPopover.value && (
          <WebSelectionPopover
            {...selectionPopover.value}
            onClose={() => {
              selectionPopover.value = null;
            }}
          />
        )}

        {/* Text tool overlay */}
        <div
          class="absolute inset-0 z-2147483646"
          style={{ pointerEvents: showTextCursor ? 'auto' : 'none', cursor: showTextCursor ? 'text' : 'default' }}
          onClick={(e) => {
            if (tool !== 'text') return;
            textInput.value = { x: e.clientX, y: e.clientY + (window.scrollY || 0) };
          }}
        />
        {textInput.value && (
          <TextInputOverlay
            x={textInput.value.x}
            y={textInput.value.y}
            scale={1}
            scrollY={0}
            onCommit={(text) => {
              if (text && textInput.value) {
                const op: TextOp = {
                  id: nanoid(),
                  tool: 'text',
                  text,
                  x: textInput.value.x,
                  y: textInput.value.y,
                  fontSize: Math.max(14, lineWidth.value * 6),
                  color: color.value,
                  lineWidth: lineWidth.value,
                  captureViewport: { width: window.innerWidth, height: window.innerHeight },
                };
                pushDeviceOp(op);
              }
              textInput.value = null;
            }}
          />
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          class="absolute inset-x-0 top-0 z-2147483645"
          style={{
            height: '100%',
            pointerEvents: showCanvas ? 'auto' : 'none',
            cursor: showCanvas ? 'crosshair' : 'default',
          }}
        />

        <InspectorLayer />

        {/* Steps aside while the demo window fills the screen: its own toolbar
            is the one to use there, and two identical bars stacked at the
            bottom edge read as a rendering fault. */}
        <div class="lp-toolbar-in hidden sm:block z-2147483647" data-away={embedInView.value ? 'true' : undefined}>
          <Toolbar />
        </div>

        <Toasts offset="below-bar" />
      </div>
    </>
  );
}
