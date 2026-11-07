import { secondaryBtn } from '@ext/lib/buttons';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { ORIGIN } from '@marklayer/brand';
import { shareUrl } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { Code } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ActionRow } from './ActionRow';
import { capture } from './analytics';
import { feedbackButtonHtml, feedbackButtonMarkdown, feedbackWidgetScript } from './feedbackButton';

/**
 * The address the pasted button points at: always the production origin, since the
 * snippet lives on someone else's site and `location.origin` may be a preview or
 * localhost. `ref=button` is what the viewer counts the arrival as.
 */
export function feedbackLink({ kind, id }: { kind: 'project' | 'page'; id: string }): string {
  return shareUrl({ origin: ORIGIN, kind, id, ref: 'button' });
}

function CopyFormat({
  label,
  value,
  format,
}: {
  label: string;
  value: string;
  format: 'html' | 'markdown' | 'script';
}) {
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
      <ActionRow icon={<Code size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setOpen(true)}>
        Feedback button for your site
      </ActionRow>
    );
  }

  const url = feedbackLink({ kind, id });
  const html = feedbackButtonHtml({ url });
  return (
    <div class="flex flex-col gap-2.5 px-3.5 py-3 max-md:px-4">
      <span class="text-ui font-medium text-(--ds-gray-1000)">Feedback button</span>
      {/* The preview is the snippet itself, so what is shown is what gets pasted. */}
      <div class="flex min-h-14 items-center justify-center rounded-md bg-(--ds-gray-alpha-100)">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div class="flex gap-1.5">
        <CopyFormat label="Copy HTML" value={html} format="html" />
        <CopyFormat label="Copy Markdown" value={feedbackButtonMarkdown({ url })} format="markdown" />
        <CopyFormat label="Copy script" value={feedbackWidgetScript({ origin: ORIGIN, kind, id })} format="script" />
      </div>
      <p class="text-meta leading-body text-(--ds-gray-900)">
        The script opens comment mode on your live page. With a CSP, allow https://marklayer.app in script-src, and
        https://marklayer.app and wss://marklayer.app in connect-src.
      </p>
    </div>
  );
}
