import type { AnnotationOp } from '@marklayer/types/ops';
import { cn } from '@marklayer/ui/cn';
import { useSignal } from '@preact/signals';
import { captureDiagnosis, diagnosisMarkdown } from '../lib/diagnosis';
import { glass } from '../lib/glass';
import { patchOp } from '../lib/ops';
import { copyText } from '../lib/toasts';

export function DiagnosisAction({ op }: { op: AnnotationOp }) {
  const busy = useSignal(false);
  const diagnose = () => {
    busy.value = true;
    try {
      patchOp({ opId: op.id, patch: { diagnosis: captureDiagnosis(op) } });
    } finally {
      busy.value = false;
    }
  };

  return (
    <div class="mt-2 flex flex-col gap-1.5">
      <button
        type="button"
        class={cn(glass.menuItem, 'self-start rounded-md px-2 py-1 text-meta')}
        disabled={busy.value}
        onClick={(e) => {
          e.stopPropagation();
          diagnose();
        }}
      >
        {busy.value ? '正在诊断…' : '诊断'}
      </button>
      {op.diagnosis && (
        <div class="text-meta text-(--ds-gray-900) leading-snug">
          <div>
            页面错误 {op.diagnosis.pageErrorCount} 条 · 失败请求 {op.diagnosis.networkFailureCount} 条
          </div>
          <div>
            {op.diagnosis.hitTest ? (op.diagnosis.hitTest.covered ? '目标被遮挡' : '未发现遮挡') : '遮挡情况未检查'}
            {op.diagnosis.partial ? ' · 部分现场不可见' : ''}
          </div>
          <button
            type="button"
            class="underline underline-offset-2"
            onClick={(e) => {
              e.stopPropagation();
              copyText(diagnosisMarkdown(op.diagnosis!), '诊断包已复制');
            }}
          >
            复制完整诊断包
          </button>
        </div>
      )}
    </div>
  );
}
