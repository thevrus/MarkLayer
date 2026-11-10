import { CommentPopover } from '@ext/components/CommentPopover';
import { InspectorLayer } from '@ext/components/InspectorLayer';
import { Toasts } from '@ext/components/Toasts';
import { Toolbar } from '@ext/components/Toolbar';
import { comments as commentsComputed, selections } from '@ext/lib/ops';
import { color, lineWidth } from '@ext/lib/prefs';
import { makeTextOp } from '@ext/lib/text-op';
import { activeTool, isDrawingTool } from '@ext/lib/tool-state';
import { CHROME_STORE_URL } from '@marklayer/brand';
import { cn } from '@marklayer/ui/cn';
import { useSignal } from '@preact/signals';
import copy from '@site/data/home-copy.json';
import { ASK_AI, ASK_AI_LABEL, COLOPHON, FOOTER_COLUMNS, TRADEMARK_NOTICE } from '@site/lib/footer';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { siProducthunt } from 'simple-icons';
import { capture } from './analytics';
import { frameViewport } from './iframeOverlay';
import { ChannelCycle } from './landing/ChannelCycle';
import { ChromeIcon, ChromeStoreLink } from './landing/ChromeStoreLink';
import { NAV_LINKS } from './landing/content';
import { DemoStage } from './landing/DemoStage';
import { FakeCursors } from './landing/FakeCursors';
import { HeroSource } from './landing/HeroSource';
import { embedInView, isMobileDevice } from './landing/landing-state';
import { MarginNote } from './landing/Proof';
import { useLandingCanvas } from './landing/useLandingCanvas';
import { useLandingSelection } from './landing/useLandingSelection';
import { useLandingShortcuts } from './landing/useLandingShortcuts';
import { GithubLink, ICON_LINK_CLS, Logo, TextInputOverlay } from './shared';
import { STATUS_LABEL, systemStatus } from './status';
import { commentPopover, selectionPopover, textInput } from './ui-state';
import { pushDeviceOp } from './viewer-state';
import { WebCommentPin } from './WebCommentPin';
import { WebSelectionHighlight } from './WebSelectionHighlight';
import { WebSelectionPopover } from './WebSelectionPopover';

/* One display step for every section head and one reading step for every
   paragraph, so no section sets its own scale. */
const HEAD_CLS = 'lp-display mx-auto max-w-[18em] text-center text-statement text-balance text-ml-fg';

/** A section head: the claim in the serif, its support on its own line under it in grey. */
function SectionHead({ title, children }: { title: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="text-center">
      <h2 class={HEAD_CLS}>{title}</h2>
      {children && <p class="mx-auto mt-4 max-w-[46ch] text-intro text-balance text-ml-fg/55">{children}</p>}
    </div>
  );
}

/** Words that break as one: `text-balance` knows nothing of sentences. Still wraps inside when the screen is narrower. */
function Phrase({ children }: { children: ComponentChildren }) {
  return <span class="inline-block">{children}</span>;
}

/* The rhythm: the head sits one step above the stage it introduces. The opening
   space is short because the hero's 108px toolbar clearance is already part of it. */
const SECTION_CLS = 'relative pt-12 sm:pt-16';
const STAGE_CLS = 'mt-12 sm:mt-14';

/**
 * True while the top of the hero is still on screen, so the nav can sit bare
 * on the sky and turn back into the glass bar once the page has scrolled. An
 * observer on a 200px sentinel at the hero's top, not a scroll listener: the
 * sentinel's own height is the scroll distance the bare bar lasts for.
 */
function useOverSky() {
  const over = useSignal(true);
  useEffect(() => {
    const el = document.getElementById('lp-sky-top');
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) over.value = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, [over]);
  return over;
}

/**
 * The marketing page, which is also a live board: every mark on the first screen
 * is a real op on the real op stream, drawn with the product's own canvas and
 * toolbar.
 *
 * The behaviour that makes that true lives in `./landing` — the drawing engine,
 * the keyboard layer, the seeded pin, uploads and presence each as one hook — so
 * what is left here is the composition.
 */
export function Landing() {
  const { canvasRef, onDown } = useLandingCanvas();
  useLandingShortcuts();
  useLandingSelection();
  const overSky = useOverSky();

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
        <header
          class="lp-nav sticky top-0 z-2147483647"
          data-away={embedInView.value ? 'true' : undefined}
          data-over-sky={overSky.value ? 'true' : undefined}
        >
          <nav class="mx-auto flex h-14 w-full max-w-page items-center justify-between gap-6 px-6 sm:px-10">
            <a href="/" class="flex items-center gap-2 no-underline">
              <Logo size={26} />
              <span class="font-ui text-lede font-semibold tracking-brand text-ml-fg">visual collaboration</span>
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
              {!isMobileDevice() && (
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener"
                  class="lp-cta ml-2 hidden h-8 items-center whitespace-nowrap rounded-lg px-3 text-ui-lg font-medium text-white no-underline transition-colors lg:inline-flex"
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
            {/* The hero owns the fold: nav plus this section is exactly one screen.
                `--lp-lift` (style.css, beside `.lp-sky`) spends a tall screen's spare height above the copy. */}
            <section class="relative isolate flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-start pt-[calc(clamp(96px,11vw,150px)+var(--lp-lift))] [@media(max-height:820px)]:pt-24 pb-20 text-center sm:pb-40">
              {/* The sky: a dusk ridge behind the nav and the white headline, running the
                  width of the page and dissolving into white before the URL field. */}
              <div id="lp-sky-top" class="pointer-events-none absolute inset-x-0 top-0 h-[200px]" aria-hidden="true" />
              <div class="lp-sky -z-1" aria-hidden="true">
                <img
                  src="/hero-dusk.webp"
                  srcset="/hero-dusk-sm.webp 1300w, /hero-dusk.webp 2600w"
                  sizes="100vw"
                  width={2600}
                  height={1130}
                  alt=""
                  decoding="async"
                  fetchpriority="high"
                />
              </div>
              {/* The demo cursors belong to the fold and scroll away with it. */}
              <FakeCursors />

              {/* Two explicit lines, no `text-balance`: only line two holds the
                  cycling word, so the block's height never changes as it swaps. */}
              {/* On the sky: white type, and the channel's marker band turns to frosted glass. */}
              <h1 class="lp-display lp-fade-up lp-on-sky text-hero text-white" style={{ animationDelay: '0.05s' }}>
                <span class="block">{copy.headlinePrefix}</span>
                <span class="block">
                  {copy.headlineJoiner} <ChannelCycle /> {copy.headlineSuffix}
                </span>
              </h1>

              <p
                class="lp-fade-up mt-6 max-w-[56ch] text-intro text-white/80 text-balance"
                style={{ animationDelay: '0.1s' }}
              >
                <Phrase>Send one link. Your client comments on the live page.</Phrase>{' '}
                <Phrase>Nothing to install, no account.</Phrase>
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
                {!isMobileDevice() && (
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

            {/* The proof: the real viewer on a shared room, which scroll grows to the whole screen. */}
            <section class={SECTION_CLS}>
              <MarginNote class="top-[22%] right-[2%]" flip>
                The whole fix
              </MarginNote>
              <SectionHead title="One link is the whole setup.">
                <Phrase>They open it and comment on the page.</Phrase>{' '}
                <Phrase>Nothing to install on either end.</Phrase>
              </SectionHead>
              <div class={STAGE_CLS}>
                <DemoStage />
              </div>
            </section>

            {/* The close, and the only full-size install button on the page. It
                takes the hero's step, so the page ends at the size it opened at. */}
            <section class="pt-28 pb-16 text-center sm:pt-36 sm:pb-20">
              <h2 class="lp-display mx-auto mb-10 max-w-[14em] text-hero text-balance text-ml-fg">
                <Phrase>Get feedback on the page,</Phrase> <Phrase>not in your inbox.</Phrase>
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
              <div class="grid grid-cols-2 gap-x-8 gap-y-9 text-ui sm:grid-cols-4">
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

            {/* The signature wordmark: full-bleed, cut at roughly half the cap
                height, dissolving into the page. It sits outside the capped
                container on purpose: the one element meant to touch both edges.
                Lifted a little clear of the bottom edge, because the product's
                own toolbar floats there and swallowed it when flush. `aria-hidden`:
                the accessible wordmark is the one in the nav. */}
            <div class="lp-wordmark-clip mt-12 select-none" aria-hidden="true">
              <span class="lp-wordmark">visual collaboration</span>
            </div>
          </footer>
        </main>

        {/* Comment overlay: absolute, spanning the document, with `scrollY` held at 0 like the canvas
            below. A `fixed` layer needed `window.scrollY` read at render, which goes stale on scroll
            because nothing re-renders it, so pins froze at a viewport offset. */}
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
            <WebCommentPin key={c.id} op={c} scrollY={0} />
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
            <WebSelectionHighlight key={op.id} op={op} scrollY={0} />
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
            scrollY={0}
            onCommit={(text) => {
              if (text && textInput.value) {
                pushDeviceOp(
                  makeTextOp({
                    text,
                    ...textInput.value,
                    color: color.value,
                    lineWidth: lineWidth.value,
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                  }),
                );
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
