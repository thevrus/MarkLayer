import { quietLinkBtn, secondaryBtn } from '@ext/lib/buttons';
import { APP_ORIGIN, shareUrl } from '@ext/lib/share';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { cn } from '@marklayer/types';
import { useState } from 'preact/hooks';
import { capture } from './analytics';
import { feedbackButtonHtml, feedbackButtonMarkdown } from './feedbackButton';

/**
 * The address the pasted button points at: always the production origin, since the
 * snippet lives on someone else's site and `location.origin` may be a preview or
 * localhost. `ref=button` is what the viewer counts the arrival as.
 */
export function feedbackLink({ kind, id }: { kind: 'project' | 'page'; id: string }): string {
  return shareUrl({ origin: APP_ORIGIN, kind, id, ref: 'button' });
}

function CopyFormat({ label, value, format }: { label: string; value: string; format: 'html' | 'markdown' }) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1600 });
  return (
    <button
      type="button"
      class={cn(secondaryBtn, 'flex-1')}
      onClick={() => {
        copy(value);
        capture('feedback_button_copied', { format });
      }}
    >
      {copied.value ? 'Copied' : label}
    </button>
  );
}

/**
 * A button the owner pastes into their own site so clients land in this room with
 * nothing installed. Collapsed until asked for, like the invite form beside it.
 */
export function FeedbackButtonSection({ kind, id }: { kind: 'project' | 'page'; id: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} class={quietLinkBtn}>
        Feedback button for your site
      </button>
    );
  }

  const url = feedbackLink({ kind, id });
  const html = feedbackButtonHtml({ url });
  return (
    <div class="flex flex-col gap-2.5">
      <span class="text-meta font-medium text-(--ds-gray-1000)">Feedback button</span>
      {/* The preview is the snippet itself, so what is shown is what gets pasted. */}
      <div class="flex min-h-14 items-center justify-center rounded-md bg-(--ds-gray-alpha-100)">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div class="flex gap-1.5">
        <CopyFormat label="Copy HTML" value={html} format="html" />
        <CopyFormat label="Copy Markdown" value={feedbackButtonMarkdown({ url })} format="markdown" />
      </div>
    </div>
  );
}
