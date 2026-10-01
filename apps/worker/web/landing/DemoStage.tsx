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
          <div class="lp-desk lp-panel">
            <img
              src="/wallpaper-hills.webp"
              width={1200}
              height={800}
              alt=""
              loading="lazy"
              decoding="async"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div class="lp-desk-pad">
              <div class="lp-window">
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
