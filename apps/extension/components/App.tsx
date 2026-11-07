import { antHash } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { useSignalEffect } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { heldOps } from '../lib/batch';
import { editableTarget } from '../lib/dom';
import { bindFigmaKeys, bindKeymap, dismissTop, HISTORY_KEYS } from '../lib/keymap';
import { useWindowMarkPointer } from '../lib/mark-hover';
import { operations, redo, undo } from '../lib/ops';
import { blockInteractions, markersVisible } from '../lib/prefs';
import { joinRoom } from '../lib/room';
import { activeTool, handTool } from '../lib/tool-state';
import { toggleUiHidden, uiHidden, visible } from '../lib/ui-state';
import { AreaLayer } from './AreaLayer';
import { BatchSend, HeldPins } from './BatchSend';
import { Canvas } from './Canvas';
import { CommentLayer } from './CommentLayer';
import { ContextMenu } from './ContextMenu';
import { GuideLayer } from './GuideLayer';
import { HintRow } from './HintRow';
import { InspectorLayer } from './InspectorLayer';
import { InspectorMarkerLayer } from './InspectorMarkerLayer';
import { MeasureLayer } from './MeasureLayer';
import { MultiInspectLayer } from './MultiInspectLayer';
import { PanLayer } from './PanLayer';
import { QuickGrabLayer } from './QuickGrabLayer';
import { SelectionLayer } from './SelectionLayer';
import { ShareDialog } from './ShareDialog';
import { TextLayer } from './TextLayer';
import { Toasts } from './Toasts';
import { Toolbar } from './Toolbar';
import { useOverlayHost } from './useOverlayHost';

// Matches the `duration-200` fade below; the unmount waits for it.
const FADE_MS = 200;

export function App() {
  useWindowMarkPointer();
  useEffect(() => {
    const guard = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (!visible.value || editableTarget(e)) return;
      fn(e);
    };

    const history = (fn: () => void) =>
      guard((e) => {
        e.preventDefault();
        fn();
      });

    const unbind = bindKeymap({
      scope: window,
      bindings: [
        {
          keys: 'Alt+KeyA',
          on: (e) => {
            e.preventDefault();
            visible.value = !visible.value;
          },
        },
        ...HISTORY_KEYS.undo.keys.map((keys) => ({ keys, on: history(undo) })),
        ...HISTORY_KEYS.redo.keys.map((keys) => ({ keys, on: history(redo) })),
        {
          keys: 'Escape',
          on: (e) => {
            if (!visible.value) return;
            const t = editableTarget(e);
            if (t) {
              t.blur();
              return;
            }
            e.preventDefault();
            // Nothing else is on screen to escape from, and it is the state a lost
            // user hits Escape to get out of — so it unwinds first.
            if (uiHidden.value) toggleUiHidden();
            else if (dismissTop()) return;
            else if (handTool.value) handTool.value = false;
            else activeTool.value = 'navigate';
          },
        },
      ],
    });
    const unbindFigma = bindFigmaKeys({ target: window, guard });
    return () => {
      unbind();
      unbindFigma();
    };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (operations.value.length > 0 || heldOps.value.length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // `joinRoom` merges rather than replaces, so arriving on a hashed link keeps
  // whatever was already drawn.
  useEffect(() => {
    const params = antHash.parse(location.hash);
    if (params) joinRoom({ id: params.id });
  }, []);

  useOverlayHost();

  // Hiding markers implies review mode — drop back to navigate so users don't
  // try to draw on an invisible canvas.
  useSignalEffect(() => {
    if (!markersVisible.value && activeTool.value !== 'navigate') {
      activeTool.value = 'navigate';
    }
  });

  const [mounted, setMounted] = useState(visible.value);
  useSignalEffect(() => {
    if (visible.value) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(id);
  });

  if (!mounted) return null;

  // Drawing/measure/inspect tools own their own pointer capture, so the markers
  // toggle only fades the placed-pin overlays — the active tool stays usable.
  const showMarkers = markersVisible.value;
  const blocking = blockInteractions.value;

  return (
    <div
      class={cn(
        'transition-opacity duration-200 ease-out pointer-events-auto',
        visible.value ? 'opacity-100' : 'opacity-0',
      )}
    >
      {blocking && (
        <div
          aria-hidden="true"
          class="fixed inset-0 z-2147483640"
          style={{ background: 'transparent', cursor: 'default' }}
          onClickCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDownCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
      <div
        class={cn('transition-opacity duration-200 ease-out', showMarkers ? 'opacity-100' : 'opacity-0')}
        style={{ pointerEvents: showMarkers ? undefined : 'none' }}
      >
        <Canvas />
        <CommentLayer />
        <SelectionLayer />
        <TextLayer />
        <AreaLayer />
        <InspectorMarkerLayer />
      </div>
      <InspectorLayer />
      <MultiInspectLayer />
      <MeasureLayer />
      <GuideLayer />
      <QuickGrabLayer />
      <PanLayer />
      {/* Figma's hide-UI: the chrome goes, the annotations stay. Hidden rather
          than unmounted so a dragged toolbar comes back where it was left. */}
      <div class={cn(uiHidden.value && 'hidden')}>
        <Toolbar />
        <div class="fixed bottom-20 left-1/2 -translate-x-1/2 z-2147483646">
          <BatchSend />
        </div>
      </div>
      <HeldPins />
      <ShareDialog />
      <ContextMenu />
      <HintRow />
      <Toasts />
    </div>
  );
}
