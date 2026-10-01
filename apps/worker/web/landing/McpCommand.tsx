import { useCopyToClipboard } from '@ext/lib/useCopy';
import { MCP_INSTALL } from '@site/lib/agent';
import { Check, Copy } from 'lucide-preact';
import { capture } from '../analytics';

export function McpCommand() {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1600 });
  return (
    <div class="lp-panel mx-auto flex max-w-[560px] items-center gap-3 rounded-xl py-2 pr-2 pl-5 text-left">
      <code class="min-w-0 flex-1 font-mono text-ui leading-body text-balance text-ml-fg wrap-anywhere">
        <span class="select-none text-ml-fg/50" aria-hidden="true">
          ${' '}
        </span>
        {MCP_INSTALL}
      </code>
      <button
        type="button"
        aria-label="Copy command"
        class="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-none bg-transparent px-3 text-ui-lg font-medium text-ml-fg/70 transition-colors hover:bg-ml-fg/[0.05] hover:text-ml-fg"
        onClick={() => {
          copy(MCP_INSTALL);
          capture('mcp_command_copied');
        }}
      >
        {copied.value ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {copied.value ? 'Copied' : 'Copy'}
      </button>
      {/* Outside the button: a button's children are presentational, so a live region inside it goes unannounced. */}
      <span class="sr-only" role="status">
        {copied.value ? 'Command copied' : ''}
      </span>
    </div>
  );
}
