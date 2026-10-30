import { DEMO_ROOM } from '@marklayer/types';
import { DemoWindow } from './DemoWindow';

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
            <div class="lp-desk-pad">
              <div class="lp-window">
                {/* Browser chrome: the window lights, and the room's address in the bar. */}
                <div class="lp-window-bar relative flex h-10 shrink-0 items-center px-4 font-ui" aria-hidden="true">
                  <span class="flex gap-1.5">
                    <i class="block size-2.5 rounded-full bg-ml-fg/15" />
                    <i class="block size-2.5 rounded-full bg-ml-fg/15" />
                    <i class="block size-2.5 rounded-full bg-ml-fg/15" />
                  </span>
                  <span class="absolute left-1/2 -translate-x-1/2 rounded-md bg-ml-fg/[0.05] px-3 py-1 font-mono text-meta text-ml-fg/60">
                    marklayer.app/s/{DEMO_ROOM.id}
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
