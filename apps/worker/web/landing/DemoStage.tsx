import { DemoWindow } from './DemoWindow';

/**
 * The demo's stage: a desktop wallpaper with a macOS window on it, holding the
 * live board.
 *
 * On desktops that support scroll-driven animation the stage is a two-screen
 * runway. The desk pins for the first screen and scroll drives it from a
 * contained window to the full viewport, holds there, then lets go — the
 * geometry lives in style.css under `.lp-stage`. Everywhere else it is a plain
 * framed figure, which is also what the runway shows before the pin engages.
 */
export function DemoStage() {
  return (
    <figure class="lp-stage m-0">
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
              <div class="lp-window-bar flex shrink-0 items-center" aria-hidden="true">
                <span class="lp-light bg-[#ff5f57]" />
                <span class="lp-light bg-[#febc2e]" />
                <span class="lp-light bg-[#28c840]" />
              </div>
              <DemoWindow />
            </div>
          </div>
        </div>
      </div>
      <figcaption class="mx-auto mt-4 w-full max-w-page px-6 text-ui text-ml-fg/60 sm:px-10">
        A live Wikipedia article in a shared room. Draw on it; everyone reading this page sees it. The board resets
        every hour.
      </figcaption>
    </figure>
  );
}
