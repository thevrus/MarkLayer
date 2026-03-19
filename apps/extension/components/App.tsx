import { useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { glass } from '../lib/glass';
import { loadAnnotations, parseUrlHash, saveAnnotations, setAnnotationId } from '../lib/share';
import {
  activeTool,
  operations,
  redo,
  SHORTCUT_MAP,
  showShareDialog,
  toast,
  toasts,
  undo,
  visible,
} from '../lib/state';
import { Canvas } from './Canvas';
import { CommentLayer } from './CommentLayer';
import { SelectionLayer } from './SelectionLayer';
import { Toolbar } from './Toolbar';

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+A toggles extension visibility
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        visible.value = !visible.value;
        return;
      }
      if (!visible.value) return;
      // Check composedPath to see through shadow DOM
      const target = e.composedPath()[0] as HTMLElement;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        if (e.key === 'Escape') {
          (target as HTMLElement).blur();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'r') {
          e.preventDefault();
          window.location.reload();
          return;
        }
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
          e.preventDefault();
          redo();
          return;
        }
      }
      const m = SHORTCUT_MAP[e.key.toUpperCase()];
      if (m) {
        activeTool.value = m;
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        activeTool.value = 'navigate';
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Intercept share → direct clipboard copy + toast
  useSignalEffect(() => {
    if (!showShareDialog.value) return;
    showShareDialog.value = false;
    const ops = operations.value;
    if (!ops.length) {
      toast('Draw something first', 'info');
      return;
    }
    toast('Saving...', 'info');
    saveAnnotations(ops).then((url) => {
      if (url) {
        navigator.clipboard.writeText(url).then(
          () => toast('Link copied!', 'success'),
          () => toast('Failed to copy link', 'error'),
        );
      } else {
        toast('Failed to save', 'error');
      }
    });
  });

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

  if (!visible.value) return null;

  return (
    <>
      <Canvas />
      <CommentLayer />
      <SelectionLayer />
      <Toolbar />
      {toasts.value.length > 0 && (
        <div class="fixed top-5 left-1/2 -translate-x-1/2 z-[2147483647] flex flex-col gap-2 items-center">
          {toasts.value.map((t) => (
            <div
              key={t.id}
              class={`${glass.surfaceSmall} ${glass.font} px-4 py-2.5 text-[12px] font-medium
                      animate-[fadeInDown_0.2s_ease-out]
                      ${t.type === 'error' ? 'text-red-300' : t.type === 'success' ? 'text-green-300' : 'text-white/70'}`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
