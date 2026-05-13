import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { tinykeys } from 'tinykeys';
import { glass } from '../lib/glass';
import { loadAnnotations, parseUrlHash, setAnnotationId } from '../lib/share';
import {
  activeTool,
  blockInteractions,
  ensureHostMutationObserver,
  ensureScrollTickListener,
  markersVisible,
  operations,
  redo,
  SHORTCUT_MAP,
  showSettings,
  showShareDialog,
  theme,
  toasts,
  undo,
  visible,
} from '../lib/state';
import { AreaLayer } from './AreaLayer';
import { Canvas } from './Canvas';
import { CommentLayer } from './CommentLayer';
import { ContextMenu } from './ContextMenu';
import { InspectorLayer } from './InspectorLayer';
import { InspectorMarkerLayer } from './InspectorMarkerLayer';
import { MeasureLayer } from './MeasureLayer';
import { MultiInspectLayer } from './MultiInspectLayer';
import { QuickGrabLayer } from './QuickGrabLayer';
import { SelectionLayer } from './SelectionLayer';
import { ShareDialog } from './ShareDialog';
import { TextLayer } from './TextLayer';
import { Toolbar } from './Toolbar';

export function App() {
  useEffect(() => {
    // Composed path lets us peek through the shadow root the page might be sitting in,
    // so an input focused inside another extension or the proxied iframe still counts.
    const editableTarget = (e: KeyboardEvent): HTMLElement | null => {
      const t = e.composedPath()[0];
      if (!(t instanceof HTMLElement)) return null;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return t;
      return null;
    };
    const guard = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => {
      if (!visible.value || editableTarget(e)) return;
      fn(e);
    };

    const bindings: Record<string, (e: KeyboardEvent) => void> = {
      'Alt+KeyA': (e) => {
        e.preventDefault();
        visible.value = !visible.value;
      },
      '$mod+KeyZ': guard((e) => {
        e.preventDefault();
        undo();
      }),
      '$mod+Shift+KeyZ': guard((e) => {
        e.preventDefault();
        redo();
      }),
      '$mod+KeyY': guard((e) => {
        e.preventDefault();
        redo();
      }),
      Escape: (e) => {
        if (!visible.value) return;
        const t = editableTarget(e);
        if (t) {
          t.blur();
          return;
        }
        if (showSettings.value) {
          showSettings.value = false;
          e.preventDefault();
          return;
        }
        if (showShareDialog.value) {
          showShareDialog.value = false;
          e.preventDefault();
          return;
        }
        activeTool.value = 'navigate';
        e.preventDefault();
      },
    };
    for (const [letter, tool] of Object.entries(SHORTCUT_MAP)) {
      bindings[`Key${letter}`] = guard((e) => {
        activeTool.value = tool;
        e.preventDefault();
      });
    }
    return tinykeys(window, bindings);
  }, []);

  // Warn before leaving page with unsaved drawings
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (operations.value.length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Single rAF-coalesced scroll listener feeds every annotation layer that
  // repositions on scroll, replacing per-component listeners.
  // Pair with the host-page MutationObserver so element-anchored ops
  // re-resolve their selectors when the page reflows or SPA-routes.
  useEffect(() => {
    ensureScrollTickListener();
    ensureHostMutationObserver();
  }, []);

  // Load shared annotations from URL hash
  useEffect(() => {
    const params = parseUrlHash();
    if (params) {
      setAnnotationId(params.id);
      loadAnnotations(params.id).then((ops) => {
        if (ops && Array.isArray(ops)) {
          operations.value = ops;
        }
      });
    }
  }, []);

  // Sync theme class to shadow host
  useSignalEffect(() => {
    const t = theme.value;
    const host = document.querySelector('mark-layer')?.shadowRoot?.host;
    if (!host) return;
    host.classList.remove('ml-dark', 'ml-light');
    t !== 'system' && host.classList.add(t === 'dark' ? 'ml-dark' : 'ml-light');
  });

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
    const id = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(id);
  });

  if (!mounted) return null;

  // Drawing/measure/inspect tools own their own pointer capture, so the markers
  // toggle only fades the placed-pin overlays — the active tool stays usable.
  const showMarkers = markersVisible.value;
  const blocking = blockInteractions.value;

  return (
    <div class={cn('transition-opacity duration-200 ease-out', visible.value ? 'opacity-100' : 'opacity-0')}>
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
      <QuickGrabLayer />
      <Toolbar />
      <ShareDialog />
      <ContextMenu />
      {toasts.value.length > 0 && (
        <div class="fixed top-5 left-1/2 -translate-x-1/2 z-2147483647 flex flex-col gap-2 items-center">
          {toasts.value.map((t) => (
            <div
              key={t.id}
              class={`${glass.surfaceSmall} ${glass.font} px-4 py-2.5 text-[12px] font-medium
                      animate-[fadeInDown_0.2s_ease-out]
                      ${t.type === 'error' ? 'text-red-500' : t.type === 'success' ? 'text-green-500' : 'text-ml-glass-fg/70'}`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
