import { toast } from '@ext/lib/state';
import { MAX_UPLOAD_BYTES, uploadResponseSchema } from '@marklayer/types';
import { type Signal, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { navigateTo } from '../signals';

/**
 * Taking a local file instead of a URL: store it first, then annotate it at the
 * path it comes back as.
 *
 * Also swallows a drop anywhere outside the field, which would otherwise
 * navigate the tab to the file and silently throw away whatever the person was
 * doing.
 */
export function useLandingUpload(): {
  fileInputRef: { current: HTMLInputElement | null };
  uploading: Signal<boolean>;
  uploadFile: (file: File) => Promise<void>;
} {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = useSignal(false);

  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // The two refusals a person can act on — too big, or not a kind we render —
  // say which; the rest throw into the shared catch.
  const uploadFile = useCallback(async (file: File) => {
    if (uploading.value) return;
    uploading.value = true;
    try {
      const res = await fetch('/f', { method: 'POST', body: file });
      if (res.status === 413) {
        toast(`That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`, 'error');
        return;
      }
      if (res.status === 415) {
        toast('That has to be a PDF or an image', 'error');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const stored = uploadResponseSchema.safeParse(await res.json());
      if (!stored.success) throw new Error('no url');
      navigateTo({ url: stored.data.url, source: 'hero_upload' });
    } catch {
      toast('Could not upload that file', 'error');
    } finally {
      uploading.value = false;
    }
  }, []);

  return { fileInputRef, uploading, uploadFile };
}
