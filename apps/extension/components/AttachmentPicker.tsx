import { cn, MAX_ATTACHMENTS, UPLOAD_IMAGE_ACCEPT } from '@marklayer/types';
import { ImagePlus, Loader2, X } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { geist } from '../lib/geist';
import { compressImage } from '../lib/image';

/**
 * Upload queue for one composer's attachments. `upload` is injected rather than
 * imported because the extension and the web app reach the same `/f` endpoint
 * through different origins (absolute vs. relative) — same split as every other
 * network call shared between the two (see `share.ts` vs. `projects.ts`).
 */
export function useAttachments(upload: (file: File | Blob) => Promise<string | null>) {
  const [ids, setIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);

  const addFiles = (files: Iterable<File>) => {
    let slots = MAX_ATTACHMENTS - ids.length - uploading;
    for (const file of files) {
      if (slots <= 0) break;
      if (!file.type.startsWith('image/')) continue;
      slots--;
      setUploading((n) => n + 1);
      void (async () => {
        try {
          // A canvas re-encode would flatten a GIF to its first frame, so those
          // upload as-is; every other format gets downscaled and recompressed —
          // the anonymous endpoint has no auth to gate volume by otherwise.
          const blob = file.type === 'image/gif' ? file : await compressImage(file);
          const id = await upload(blob);
          if (id) setIds((prev) => [...prev, id]);
        } finally {
          setUploading((n) => n - 1);
        }
      })();
    }
  };

  /** Pulls image files out of a paste event, so a screenshot on the clipboard attaches the same way a picked file does. */
  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) addFiles(files);
  };

  return {
    ids,
    /** Gates a composer's submit: an in-flight paste-upload has no second chance to attach once the comment is posted. */
    uploading: uploading > 0,
    full: ids.length + uploading >= MAX_ATTACHMENTS,
    addFiles,
    onPaste,
    remove: (id: string) => setIds((prev) => prev.filter((x) => x !== id)),
    reset: () => setIds([]),
  };
}

export type Attachments = ReturnType<typeof useAttachments>;

/**
 * The add-image button plus the thumbnail row it fills. Sits under a composer's
 * textarea; `resolveUrl` turns an upload id into a servable `src`, same
 * extension/web split as `upload` above.
 */
export function AttachmentRow({
  attachments,
  resolveUrl,
}: {
  attachments: Attachments;
  resolveUrl: (id: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div class="flex items-center gap-1.5 flex-wrap mt-1.5">
      {attachments.ids.map((id) => (
        <div key={id} class="relative shrink-0">
          <img
            src={resolveUrl(id)}
            alt="Attached screenshot"
            class="h-10 w-10 rounded-md object-cover border border-(--ds-gray-alpha-400)"
          />
          <button
            type="button"
            onClick={() => attachments.remove(id)}
            aria-label="Remove screenshot"
            class="absolute -top-1.5 -right-1.5 grid place-items-center h-4 w-4 rounded-full
                   bg-(--ds-gray-1000) text-(--ds-background-100) cursor-pointer border-none p-0
                   outline-none transition-colors duration-150 ease-out hover:bg-(--ds-gray-1000)/90
                   focus-visible:outline-solid focus-visible:outline-2
                   focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)"
          >
            <X size={10} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      ))}
      {attachments.uploading && (
        <div class="h-10 w-10 rounded-md border border-(--ds-gray-alpha-400) grid place-items-center shrink-0">
          <Loader2 size={14} class="animate-spin text-(--ds-gray-700)" aria-hidden="true" />
        </div>
      )}
      <button
        type="button"
        disabled={attachments.full}
        onClick={() => inputRef.current?.click()}
        title="Attach a screenshot"
        class={cn(geist.ctlXs, geist.ctlIdle, 'disabled:opacity-40 disabled:pointer-events-none')}
      >
        <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_IMAGE_ACCEPT}
        multiple
        class="hidden"
        onChange={(e) => {
          const input = e.currentTarget;
          if (input.files) attachments.addFiles(input.files);
          input.value = '';
        }}
      />
    </div>
  );
}

/** A posted comment or reply's own attachments — plain thumbnails, opening full-size in a new tab. */
export function AttachmentGallery({ ids, resolveUrl }: { ids: string[]; resolveUrl: (id: string) => string }) {
  if (ids.length === 0) return null;
  return (
    <div class="flex items-center gap-1.5 flex-wrap mt-1.5">
      {ids.map((id) => (
        <a key={id} href={resolveUrl(id)} target="_blank" rel="noreferrer" class="shrink-0">
          <img
            src={resolveUrl(id)}
            alt="Attached screenshot"
            class="h-14 w-14 rounded-md object-cover border border-(--ds-gray-alpha-400)"
          />
        </a>
      ))}
    </div>
  );
}
