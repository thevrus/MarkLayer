import { DEMO_ROOM } from '@marklayer/types';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-preact';
import { DemoWindow } from './DemoWindow';

/** macOS's close, minimise and zoom, in the system's own colours. */
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];

/**
 * The demo's stage: a wallpaper desk with the live viewer on it.
 *
 * On desktops that support scroll-driven animation the stage is a two-screen
 * runway. The desk pins for the first screen and scroll drives it from a
 * contained window to the full viewport, holds there, then lets go — the
 * geometry lives in style.css under `.lp-stage-run`. Everywhere else it is a plain
 * framed figure, which is also what the runway shows before the pin engages.
 */
export function DemoStage() {
  return (
    <figure class="lp-stage m-0">
      {/* The runway is its own box so the caption follows it: inside it, the pinned desk slid over the caption. */}
      <div class="lp-stage-run">
        <div class="lp-stage-pin">
          <div class="lp-desk">
            <img
              src="/desk-mesa.webp"
              width={1300}
              height={732}
              alt=""
              loading="lazy"
              decoding="async"
              class="lp-desk-art"
            />
            <div class="lp-desk-pad">
              <div class="lp-window">
                {/* Browser chrome, Safari's at rest: the lights, back and forward, the address in the middle. */}
                <div
                  class="lp-window-bar grid h-11 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center sm:grid-cols-[1fr_minmax(0,30rem)_1fr] gap-3 px-3.5 font-ui"
                  aria-hidden="true"
                >
                  <span class="flex items-center gap-4">
                    <span class="flex gap-2">
                      {LIGHTS.map((color) => (
                        <i key={color} class="lp-window-light" style={{ background: color }} />
                      ))}
                    </span>
                    <span class="hidden items-center gap-3 text-ml-fg/25 sm:flex">
                      <ChevronLeft size={18} strokeWidth={2} />
                      <ChevronRight size={18} strokeWidth={2} />
                    </span>
                  </span>
                  <span class="flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md bg-ml-fg/[0.06] px-3 text-meta text-ml-fg/70">
                    <Lock size={11} strokeWidth={2.25} class="shrink-0 text-ml-fg/45" />
                    {/* Safari shows the bare domain at rest; the room's path only fits from `sm`. */}
                    <span class="truncate">
                      marklayer.app<span class="hidden sm:inline">/s/{DEMO_ROOM.id}</span>
                    </span>
                  </span>
                </div>
                <DemoWindow />
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption class="mt-5 text-center text-ui text-ml-fg/60">
        A live Wikipedia article in a shared room. Draw on it; everyone reading this page sees it. The board resets
        every hour.
      </figcaption>
    </figure>
  );
}
