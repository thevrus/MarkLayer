import { toast } from '@ext/lib/state';
import { MAX_UPLOAD_BYTES, UPLOAD_FORMATS, uploadResponseSchema } from '@marklayer/types';
import { type Signal, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { navigateTo } from '../signals';

export type UploadKind = 'pdf' | 'image';

const ACCEPTED = new Set(UPLOAD_FORMATS.map((format) => format.contentType));

/** A file with no type (some drags report none) is judged by its name; the server sniffs either way. */
const kindOf = (file: File): UploadKind =>
  file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name)) ? 'pdf' : 'image';

/**
 * Taking a local file instead of a URL: store it first, then annotate it at the
 * path it comes back as.
 *
 * Also swallows a drop anywhere outside the field, which would otherwise
 * navigate the tab to the file and silently throw away whatever the person was
 * doing, and takes a pasted file — a screenshot, or a file copied in the Finder.
 */
export function useLandingUpload(): {
  fileInputRef: { current: HTMLInputElement | null };
  /** The kind of file in flight, so the field can say what it is waiting on. */
  uploading: Signal<UploadKind | null>;
  uploadFile: (file: File) => Promise<void>;
} {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = useSignal<UploadKind | null>(null);

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
    const swallow = (e: DragEvent) => e.preventDefault();
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
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
      window.removeEventListener('paste', onPaste);
    };
  }, [uploadFile]);

  return { fileInputRef, uploading, uploadFile };
}
