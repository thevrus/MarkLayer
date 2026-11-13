import { undoRedoFlash, visibleOperations } from '@ext/lib/ops';
import { inView, opBounds, renderOp } from '@ext/lib/renderer';
import { useSignalEffect } from '@preact/signals';
import { useCallback } from 'preact/hooks';
import { dockedPanelsWidth } from '../DockedPanel';
import { originalWidth } from '../projects';
import {
  cssScale,
  DEVICE_WIDTHS,
  deviceMode,
  iframeScrollY,
  isStillFrame,
  MAX_AUTO_UPSCALE,
  opMatchesDevice,
  viewerZoom,
} from '../viewer-state';

/** Narrowest space auto-fit will size a device frame into before letting it overflow and scroll. */
const MIN_DEVICE_FIT_WIDTH = 320;

/** Fits the frame and repaints every committed op onto the canvas. */
export function useCanvasPainter({
  canvasRef,
  viewerRef,
  repainted,
}: {
  canvasRef: { current: HTMLCanvasElement | null };
  viewerRef: { current: HTMLDivElement | null };
  /** A stroke in progress has to take the repainted marks as its new background. */
  repainted: () => void;
}) {
  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = viewerRef.current;
    // Fit against the scroll container, never #viewer itself — #viewer's width
    // is `originalWidth * cssScale`, so measuring it turns auto-fit into a
    // one-way ratchet (shrinks once, never recovers when the window widens).
    // Floored off the fractional rect, not `clientWidth`: a 1339.5px container
    // rounds up to 1340, and a frame sized to fit 1340 overflows it by half a
    // pixel — enough for `overflow-x: auto` to raise a scrollbar.
    const containerW = viewer?.parentElement
      ? Math.floor(viewer.parentElement.getBoundingClientRect().width)
      : window.innerWidth;
    const viewerH = viewer ? viewer.clientHeight : window.innerHeight;
    const dev = deviceMode.value;
    // In a device viewport the panels dock as flex siblings and take real width
    // from the frame, so auto-fit has to size against what is left — measuring
    // the container alone scales the frame under whichever panel is open. The
    // floor keeps a narrow window from fitting the frame down to a sliver; past
    // it the frame keeps its size and the row scrolls.
    const availW = dev === 'desktop' ? containerW : Math.max(MIN_DEVICE_FIT_WIDTH, containerW - dockedPanelsWidth());
    const refW = dev === 'desktop' ? originalWidth.value || availW : DEVICE_WIDTHS[dev];
    const z = viewerZoom.value;
    // The landing's embedded room fills a desk as wide as the screen; upscaling a
    // narrower capture there reads as zoomed in, so it only ever fits down.
    const ceiling = isStillFrame.value ? 1 : MAX_AUTO_UPSCALE;
    const cs = !refW || !availW ? 1 : z === 'auto' ? Math.min(ceiling, availW / refW) : z;
    if (cssScale.value !== cs) cssScale.value = cs;
    const canvasW = refW;
    const canvasH = Math.round(viewerH / cs);
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    const scrollY = iframeScrollY.value;
    ctx.translate(0, -scrollY);
    for (const op of visibleOperations.value) {
      if (op.tool === 'comment' || op.tool === 'selection') continue;
      if (!opMatchesDevice(op)) continue;
      if (!inView(opBounds(op), 0, scrollY, canvasW, canvasH)) continue;
      renderOp(ctx, op, 0, 0);
    }
    ctx.restore();
    repainted();
  }, []);

  useSignalEffect(() => {
    visibleOperations.value;
    iframeScrollY.value;
    renderAll();
  });

  // A device switch lands before the layout it causes, so refit once the boxes `renderAll` measures settle.
  useSignalEffect(() => {
    const viewer = viewerRef.current;
    if (deviceMode.value === 'desktop' || !viewer) return;
    const observer = new ResizeObserver(() => renderAll());
    observer.observe(viewer);
    if (viewer.parentElement) observer.observe(viewer.parentElement);
    return () => observer.disconnect();
  });

  useSignalEffect(() => {
    const v = undoRedoFlash.value;
    if (v > 0) canvasRef.current?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  useSignalEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(renderAll, 100);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  return renderAll;
}
