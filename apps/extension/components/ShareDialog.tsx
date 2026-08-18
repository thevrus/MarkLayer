import { Dialog } from '@base-ui/react/dialog';
import { cn } from '@marklayer/types';
import { useSignalEffect } from '@preact/signals';
import { AlertTriangle, Bot, Check, Copy, Link2, MonitorOff, X } from 'lucide-preact';
import { nanoid } from 'nanoid';
import { useState } from 'preact/hooks';
import { glass } from '../lib/glass';
import { portalContainer } from '../lib/portal';
import {
  claudeMcpCommand,
  getRoomId,
  getShareUrl,
  isLikelyEmbedHostile,
  isShareableUrl,
  npxMcpCommand,
  saveAnnotations,
} from '../lib/share';
import {
  clearInspectorStack,
  color,
  getCommentMeta,
  inspectorStack,
  lineWidth,
  localUser,
  operations,
  pushOp,
  showShareDialog,
  toast,
} from '../lib/state';
import type { CommentOp } from '../lib/types';
import { useCopyToClipboard } from '../lib/useCopy';

/**
 * Convert any pending inspector-stack items into CommentOps so they sync to the
 * room and become visible to the agent. Inspector items carry rich AI-ready
 * markdown (selector + framework + cssStack); we use that as the comment body.
 *
 * We try to anchor each pin to the element its selector resolves to so users see
 * the pin where it belongs, not stacked at the top-left of the page. If the
 * selector no longer matches anything, we fall back to a grid layout.
 */
function flushInspectorStackToComments(): number {
  const items = inspectorStack.value;
  if (!items.length) return 0;
  const baseNum = operations.value.filter((o) => o.tool === 'comment' && !o.parentId).length;
  let fallbackIdx = 0;
  items.forEach((item, i) => {
    let x: number;
    let y: number;
    const el = item.selector ? document.querySelector(item.selector) : null;
    if (el) {
      const rect = el.getBoundingClientRect();
      x = rect.left + rect.width / 2 + scrollX;
      y = rect.top + rect.height / 2 + scrollY;
    } else {
      const col = fallbackIdx % 4;
      const row = Math.floor(fallbackIdx / 4);
      x = 80 + col * 56 + scrollX;
      y = 80 + row * 56 + scrollY;
      fallbackIdx++;
    }
    // Task first, then the element snapshot — order matters for the MCP agent
    // reading these comments: the user's instruction is what they need to act
    // on, and the snapshot is supporting context. Without this, the user's
    // typed task was silently dropped on flush.
    const text = item.comment ? `## Task\n\n${item.comment}\n\n${item.markdown}` : item.markdown;
    const op: CommentOp = {
      id: nanoid(),
      tool: 'comment',
      num: baseNum + i + 1,
      text,
      x,
      y,
      color: color.value,
      lineWidth: lineWidth.value,
      ts: Date.now() + i,
      author: localUser.name,
      meta: getCommentMeta(),
    };
    pushOp(op);
  });
  clearInspectorStack();
  return items.length;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={label}
      class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer
             border border-ml-glass-fg/12 bg-ml-glass-fg/5
             text-ml-glass-fg/80 hover:text-ml-glass-fg hover:bg-ml-glass-fg/10
             transition-[color,background-color,border-color] duration-150"
    >
      {copied.value ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied.value ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ShareDialog() {
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Open: flush any pending inspector items into comments, then generate a URL
  // and save annotations in the background. Allow opening with no annotations
  // so users can hand a room to an agent before they've started annotating.
  useSignalEffect(() => {
    if (!showShareDialog.value) {
      setShareUrl(null);
      return;
    }
    const flushed = flushInspectorStackToComments();
    if (flushed > 0) {
      toast(`Added ${flushed} inspector ${flushed === 1 ? 'item' : 'items'}`, 'success');
    }
    const url = getShareUrl();
    setShareUrl(url);
    const ops = operations.value;
    if (ops.length) {
      saveAnnotations(ops).then((ok) => {
        if (!ok) toast('Failed to save — link may not work', 'error');
      });
    }
  });

  if (!showShareDialog.value || !shareUrl) return null;

  const roomId = getRoomId();
  const claudeCommand = claudeMcpCommand(roomId);
  const npxCommand = npxMcpCommand(roomId);
  const shareable = isShareableUrl();
  const embedHostile = shareable && isLikelyEmbedHostile();

  return (
    <Dialog.Root
      open={showShareDialog.value}
      onOpenChange={(open: boolean) => {
        if (!open) showShareDialog.value = false;
      }}
    >
      <Dialog.Portal container={portalContainer.value ?? undefined}>
        <Dialog.Backdrop
          className="fixed inset-0 z-[2147483646] bg-black/40 backdrop-blur-sm
                     animate-[fadeInDown_0.15s_ease-out]"
        />
        <Dialog.Popup
          className={cn(
            glass.surfaceSmall,
            glass.font,
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2147483646]',
            'w-[420px] max-w-[calc(100vw-32px)] p-4 flex flex-col gap-3 pointer-events-auto',
          )}
        >
          <div class="flex items-center justify-between">
            <Dialog.Title className="text-[13px] font-semibold text-ml-glass-fg/90 m-0">Share annotations</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="p-1 rounded-md text-ml-glass-fg/60 hover:text-ml-glass-fg hover:bg-ml-glass-fg/8 cursor-pointer"
            >
              <X size={13} aria-hidden="true" />
            </Dialog.Close>
          </div>

          {/* Share link — only when the page can actually be proxied through marklayer.app */}
          {shareable ? (
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ml-glass-fg/60">
                <Link2 size={11} aria-hidden="true" />
                Public link
              </div>
              <div class="flex items-center gap-1.5">
                <code
                  class="flex-1 px-2.5 py-1.5 rounded-md bg-ml-glass-fg/5 border border-ml-glass-fg/10
                         text-[12px] text-ml-glass-fg/85 font-mono truncate"
                >
                  {shareUrl}
                </code>
                <CopyButton value={shareUrl} label="Copy link" />
              </div>
              {embedHostile && (
                <div
                  class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-amber-400/10 border border-amber-400/25
                         text-[11.5px] text-ml-glass-fg/75 leading-snug"
                >
                  <AlertTriangle size={12} class="shrink-0 mt-px text-amber-400/90" aria-hidden="true" />
                  <span>
                    This site usually blocks embedding, so the public viewer may not load. Annotations still sync to
                    agents via the command below.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div
              class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-ml-glass-fg/5 border border-ml-glass-fg/10
                     text-[11.5px] text-ml-glass-fg/70 leading-snug"
            >
              <MonitorOff size={12} class="shrink-0 mt-px" aria-hidden="true" />
              <span>
                Public viewer isn't available on local pages — the marklayer.app proxy can't reach localhost. Agent
                connections work fine; copy the command below.
              </span>
            </div>
          )}

          {/* Connect an AI agent */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ml-glass-fg/60">
              <Bot size={11} aria-hidden="true" />
              Connect an AI agent
            </div>
            <p class="text-[11.5px] text-ml-glass-fg/70 leading-snug m-0">
              Let an agent read and resolve your annotations. Run once in any project:
            </p>
            <div class="flex items-center gap-1.5">
              <code
                class="flex-1 px-2.5 py-1.5 rounded-md bg-ml-glass-fg/5 border border-ml-glass-fg/10
                       text-[11.5px] text-ml-glass-fg/85 font-mono truncate"
              >
                {claudeCommand}
              </code>
              <CopyButton value={claudeCommand} label="Copy Claude Code command" />
            </div>
            <details class="text-[11px] text-ml-glass-fg/60">
              <summary class="cursor-pointer select-none hover:text-ml-glass-fg/80">Other agents…</summary>
              <div class="mt-1.5 flex items-center gap-1.5">
                <code
                  class="flex-1 px-2.5 py-1.5 rounded-md bg-ml-glass-fg/5 border border-ml-glass-fg/10
                         text-[11px] text-ml-glass-fg/85 font-mono truncate"
                >
                  {npxCommand}
                </code>
                <CopyButton value={npxCommand} label="Copy npx command" />
              </div>
              <p class="mt-1.5 text-[10.5px] text-ml-glass-fg/60 leading-snug">
                Cursor / Codex / Windsurf: paste the npx command into your MCP config under a "marklayer" entry.
              </p>
            </details>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
