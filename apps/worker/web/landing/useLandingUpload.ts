import { toast } from '@ext/lib/state';
import { MAX_UPLOAD_BYTES, PICKABLE_TYPES, uploadResponseSchema } from '@marklayer/types';
import { type Signal, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { navigateTo, withScheme } from '../signals';

export type UploadKind = 'pdf' | 'image';
/** What a drag in flight will become on release: a stored file, or a page to open. */
export type DragKind = UploadKind | 'link';

const ACCEPTED = new Set(PICKABLE_TYPES);

/** dragover repeats every ~350ms in Firefox, the slowest; a longer silence means the drag went elsewhere. */
const DRAG_IDLE_MS = 800;
/** One token, so prose that merely contains a domain is not taken for an address. */
const ADDRESS = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}\S*$/i;

/** A file with no type (some drags report none) is judged by its name; the server sniffs either way. */
const kindOf = (file: File): UploadKind =>
  file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name)) ? 'pdf' : 'image';

const carriesSource = (dt: DataTransfer) => dt.types.includes('Files') || dt.types.includes('text/uri-list');

/** Only kind and type are readable before the drop. Files win over a link: a dragged page image carries both. */
function draggedKind(dt: DataTransfer): DragKind | null {
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    if (item.type === 'application/pdf') return 'pdf';
    if (item.type.startsWith('image/')) return 'image';
  }
  return dt.types.includes('text/uri-list') ? 'link' : null;
}

/** The first entry of a dropped URI list. Plain text is ignored: the drag never lit the field for it. */
function droppedLink(dt: DataTransfer): string | null {
  const listed = dt
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith('#'));
  const text = listed?.trim() ?? '';
  return ADDRESS.test(text) ? withScheme(text) : null;
}

/**
 * Taking a local file instead of a URL: store it first, then annotate it at the
 * path it comes back as.
 *
 * Takes a file or link dropped anywhere on the page (an ignored drop would navigate
 * the tab to the file and throw away whatever the person was doing), and a pasted
 * file: a screenshot, or one copied in the Finder.
 */
export function useLandingUpload(): {
  fileInputRef: { current: HTMLInputElement | null };
  /** The kind of file in flight, so the field can say what it is waiting on. */
  uploading: Signal<UploadKind | null>;
  /** A file or link is being dragged over the page. */
  dragging: Signal<boolean>;
  /** What that drag is, when the browser says before the drop; null for a file whose type it withholds. */
  dragKind: Signal<DragKind | null>;
  uploadFile: (file: File) => Promise<void>;
} {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = useSignal<UploadKind | null>(null);
  const dragging = useSignal(false);
  const dragKind = useSignal<DragKind | null>(null);

  // The two refusals a person can act on — too big, or not a kind we render —
  // say which; the rest throw into the shared catch.
  const uploadFile = useCallback(async (file: File) => {
    if (uploading.value) return;
    // The field swaps to the file's kind while it uploads, hiding whatever had focus.
    const focused = document.activeElement;
    uploading.value = kindOf(file);
    try {
      const res = await fetch('/f', { method: 'POST', body: file });
      if (res.status === 413) {
        toast(`That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`, { type: 'error' });
        return;
      }
      if (res.status === 415) {
        toast('That has to be a PDF or an image', { type: 'error' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const stored = uploadResponseSchema.safeParse(await res.json());
      if (!stored.success) throw new Error('no url');
      navigateTo({ url: stored.data.url, source: 'hero_upload' });
    } catch {
      toast('Could not upload that file', { type: 'error' });
    } finally {
      uploading.value = null;
      // A frame later, once the field it came from is back on screen.
      if (focused instanceof HTMLElement) requestAnimationFrame(() => focused.focus());
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      // A comment or a text note takes a paste as words, never as an upload.
      if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (target instanceof HTMLInputElement && target.name !== 'url') return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => ACCEPTED.has(f.type));
      if (!file) return;
      // In the URL field, copied cells' text beats the image rendition riding with it; a Finder
      // copy's only text is the file's own name, so that still uploads.
      const text = e.clipboardData?.getData('text/plain').trim();
      if (target instanceof HTMLInputElement && text && text !== file.name) return;
      e.preventDefault();
      void uploadFile(file);
    };
    let idle: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(idle);
      dragging.value = false;
      dragKind.value = null;
    };
    // preventDefault on every drag, relevant or not, so a stray drop never navigates the tab away.
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt || !carriesSource(dt)) return;
      dragging.value = true;
      dragKind.value = draggedKind(dt);
      clearTimeout(idle);
      idle = setTimeout(settle, DRAG_IDLE_MS);
    };
    // Crossing into a child fires this too, so only a point on the viewport's rim means the pointer left.
    const onDragLeave = (e: DragEvent) => {
      if (e.clientX > 0 && e.clientY > 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight) return;
      settle();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      settle();
      const dt = e.dataTransfer;
      if (!dt || uploading.value) return;
      const file = dt.files[0];
      if (file) {
        void uploadFile(file);
        return;
      }
      const url = droppedLink(dt);
      if (url) navigateTo({ url, source: 'hero_drop' });
    };
    window.addEventListener('dragenter', onDragOver);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('dragenter', onDragOver);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [uploadFile]);

  return { fileInputRef, uploading, dragging, dragKind, uploadFile };
}
