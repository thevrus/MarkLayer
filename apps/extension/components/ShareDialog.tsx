import { Dialog } from '@base-ui/react/dialog';
import { mcpAddCommand, mcpEndpoint } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { useSignalEffect } from '@preact/signals';
import { AlertTriangle, Bot, Check, Copy, Link2, MonitorOff, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { track } from '../lib/analytics';
import { geist } from '../lib/geist';
import { glass } from '../lib/glass';
import { flushInspectorStack } from '../lib/inspector-stack';
import { useDismissible } from '../lib/keymap';
import { operations } from '../lib/ops';
import { portalContainer } from '../lib/portal';
import { activeRoomId, canPushSnapshot, getRoomId } from '../lib/room-id';
import {
  getShareUrl,
  HOW_IT_WORKS_URL,
  isLikelyEmbedHostile,
  isShareableUrl,
  npxMcpCommand,
  type SaveFailure,
  saveAnnotations,
} from '../lib/share';
import { toast } from '../lib/toasts';
import { showShareDialog } from '../lib/ui-state';
import { useCopyToClipboard } from '../lib/useCopy';
import { PanelSection } from './PanelSection';

function saveFailureMessage(reason: SaveFailure): string {
  switch (reason) {
    case 'view-only':
      return 'This link is view-only — your marks were not saved';
    case 'joined-room':
      return "This is a shared room: your marks weren't pushed to it";
    case 'error':
      return 'Failed to save — link may not work';
  }
}

function CopyButton({ value, label, onCopy }: { value: string; label: string; onCopy: () => void }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={() => {
        copy(value);
        onCopy();
      }}
      aria-label={label}
      class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-meta font-semibold cursor-pointer
             border border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100)
             text-(--ds-gray-1000) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)
             transition-[color,background-color,border-color] duration-150"
    >
      {copied.value ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied.value ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ShareDialog() {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  useDismissible({
    open: showShareDialog,
    close: () => {
      showShareDialog.value = false;
    },
  });

  // Opens with no annotations too, so users can hand a room to an agent before annotating.
  useSignalEffect(() => {
    if (!showShareDialog.value) {
      setShareUrl(null);
      return;
    }
    const flushed = flushInspectorStack();
    if (flushed > 0) {
      toast(`Added ${flushed} inspector ${flushed === 1 ? 'item' : 'items'}`, { type: 'success' });
    }
    const url = getShareUrl();
    setShareUrl(url);
    // Sharing is what binds this canvas to a room, so the socket opens from here
    // rather than wherever the id happens to be read.
    activeRoomId.value = getRoomId();
    const ops = operations.value;
    // A point-in-time check, not a subscription: depending on the socket's state
    // would re-run this whole effect every time it changed.
    if (ops.length && canPushSnapshot()) {
      saveAnnotations(ops).then((res) => {
        if (res.ok) return;
        toast(saveFailureMessage(res.reason), { type: 'error' });
      });
    }
  });

  if (!showShareDialog.value || !shareUrl) return null;

  const roomId = getRoomId();
  const claudeCommand = mcpAddCommand({ roomId });
  const endpoint = mcpEndpoint({ roomId });
  const npxCommand = npxMcpCommand({ roomId });
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
          // A flat scrim, no blur: Geist dims the page behind a dialog, it
          // does not frost it. Top layer, not one below: the web app's sidebars
          // sit at 2147483647, and a step below that dimmed the page while
          // leaving the panels at full brightness. INT32_MAX has no step above
          // it, so this matches them and wins on paint order — sound because the
          // dialog is portalled, and so is always the later element.
          className="fixed inset-0 z-2147483647 bg-black/50 animate-[fadeInDown_0.15s_ease-out]"
        />
        <Dialog.Popup
          className={cn(
            geist.surface,
            glass.font,
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-2147483647',
            'w-[420px] max-w-[calc(100vw-32px)] p-4 flex flex-col gap-3 pointer-events-auto',
          )}
        >
          <div class="flex items-center justify-between">
            <Dialog.Title className="text-ui font-semibold text-(--ds-gray-1000) m-0">Share annotations</Dialog.Title>
            <Dialog.Close aria-label="Close" className={cn(geist.ctlSm, geist.ctlIdle, '-mr-1')}>
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </Dialog.Close>
          </div>

          {/* Share link — only when the page can actually be proxied through marklayer.app */}
          {shareable ? (
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-1.5 text-meta font-medium text-(--ds-gray-900)">
                <Link2 size={11} aria-hidden="true" />
                Public link
              </div>
              <div class="flex items-center gap-1.5">
                <code
                  class="flex-1 px-2.5 py-1.5 rounded-md bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                         text-meta text-(--ds-gray-1000) font-mono truncate"
                >
                  {shareUrl}
                </code>
                <CopyButton value={shareUrl} label="Copy link" onCopy={() => track('share_link_copied')} />
              </div>
              {embedHostile && (
                <div
                  class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-amber-400/10 border border-amber-400/25
                         text-meta text-(--ds-gray-1000) leading-snug"
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
              class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                     text-meta text-(--ds-gray-900) leading-snug"
            >
              <MonitorOff size={12} class="shrink-0 mt-px" aria-hidden="true" />
              <span>
                The public viewer can't reach localhost, so there is no link for local pages. Agents still connect with
                the command below.
              </span>
            </div>
          )}

          {/* Connect an AI agent */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-meta font-medium text-(--ds-gray-900)">
              <Bot size={11} aria-hidden="true" />
              Connect an AI agent
            </div>
            <p class="text-meta text-(--ds-gray-900) leading-snug m-0">
              Your agent reads this page and resolves these annotations live. Run once in your project:
            </p>
            <div class="flex items-center gap-1.5">
              <code
                class="flex-1 px-2.5 py-1.5 rounded-md bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                       text-meta text-(--ds-gray-1000) font-mono truncate"
              >
                {claudeCommand}
              </code>
              <CopyButton
                value={claudeCommand}
                label="Copy Claude Code command"
                onCopy={() => track('mcp_command_copied', { command: 'claude' })}
              />
            </div>
            <PanelSection label="Cursor, Codex, Windsurf…">
              <div class="flex items-center gap-1.5">
                <code
                  class="flex-1 px-2.5 py-1.5 rounded-md bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                         text-meta text-(--ds-gray-1000) font-mono truncate"
                >
                  {endpoint}
                </code>
                <CopyButton
                  value={endpoint}
                  label="Copy MCP config entry"
                  onCopy={() => track('mcp_command_copied', { command: 'endpoint' })}
                />
              </div>
              <p class="mt-1.5 text-meta text-(--ds-gray-900) leading-snug m-0">
                Add as an HTTP MCP server named "marklayer". Nothing to install: the link is the server.
              </p>
            </PanelSection>
            <PanelSection label="Local server (npx)">
              <div class="flex items-center gap-1.5">
                <code
                  class="flex-1 px-2.5 py-1.5 rounded-md bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400)
                         text-meta text-(--ds-gray-1000) font-mono truncate"
                >
                  {npxCommand}
                </code>
                <CopyButton
                  value={npxCommand}
                  label="Copy npx command"
                  onCopy={() => track('mcp_command_copied', { command: 'npx' })}
                />
              </div>
              <p class="mt-1.5 text-meta text-(--ds-gray-900) leading-snug m-0">
                For a client that cannot reach a remote MCP server yet.
              </p>
            </PanelSection>
          </div>

          <a
            href={HOW_IT_WORKS_URL}
            target="_blank"
            rel="noopener"
            onClick={() => track('share_how_it_works_clicked')}
            class="text-meta text-(--ds-gray-900) hover:text-(--ds-gray-1000) no-underline hover:underline transition-colors"
          >
            How MarkLayer works
          </a>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
