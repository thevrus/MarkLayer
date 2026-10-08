import { cn } from '@marklayer/types';
import { useState } from 'preact/hooks';
import { agentFix, checkRequest, confirmFixed, reportNotFixed } from '../lib/checkFix';
import { getReplies } from '../lib/state';
import type { CommentOp } from '../lib/types';

const actionCls = cn(
  'text-meta font-medium px-3 py-1.5 rounded-lg cursor-pointer',
  'border border-(--ds-gray-alpha-400) bg-(--ds-gray-alpha-100) text-(--ds-gray-1000)',
  'transition-[background-color,border-color] duration-150 ease-out hover:border-(--ds-gray-700)',
);

/**
 * "Fixed by <agent>" with check / not fixed / sign off. Renders nothing on any
 * other thread, so a host mounts it unconditionally.
 */
export function AgentFixBanner({ op }: { op: CommentOp }) {
  // Once checked the human is judging the result, so the prompt changes from "look" to "verdict".
  const [checked, setChecked] = useState(false);
  const fix = agentFix({ op, replies: getReplies(op.id) });
  if (!fix) return null;

  return (
    <div class="px-3.5 py-2.5 flex flex-col gap-2">
      <div class="min-w-0">
        <span class="text-meta font-semibold text-(--ds-gray-1000)">Fixed by {fix.agent}</span>
        <p class="m-0 mt-0.5 text-ui leading-body text-(--ds-gray-900) wrap-break-word whitespace-pre-wrap line-clamp-4">
          {fix.summary}
        </p>
      </div>
      <div class="flex gap-1.5">
        {checked ? (
          <button type="button" class={actionCls} onClick={() => confirmFixed(op.id)}>
            Looks good
          </button>
        ) : (
          <button
            type="button"
            class={actionCls}
            onClick={() => {
              checkRequest.value = op.id;
              setChecked(true);
            }}
          >
            Check it
          </button>
        )}
        <button
          type="button"
          class={actionCls}
          onClick={() => {
            reportNotFixed(op.id);
            setChecked(false);
          }}
        >
          Not fixed
        </button>
      </div>
    </div>
  );
}
