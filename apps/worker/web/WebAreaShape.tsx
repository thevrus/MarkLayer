import { AreaCard, areaMenuItems, areaPaint } from '@ext/components/AreaCard';
import { AttachmentGallery } from '@ext/components/AttachmentPicker';
import { reprojectBox } from '@ext/lib/anchor';
import { openContextMenu } from '@ext/lib/context-menu';
import { fileUrl } from '@ext/lib/share';
import type { AreaOp } from '@ext/lib/types';
import { iframeMutationTick } from './viewer-state';

interface Props {
  op: AreaOp;
  scrollY: number;
  frameDoc?: Document | null;
}

export function WebAreaShape({ op, scrollY, frameDoc }: Props) {
  iframeMutationTick.value; // re-resolve anchor when iframe DOM mutates
  const { resolved, stroke, fill } = areaPaint(op);
  const {
    x,
    y,
    width: w,
    height: h,
    strategy,
  } = reprojectBox({
    target: op.target,
    startX: op.startX,
    startY: op.startY,
    endX: op.endX,
    endY: op.endY,
    ctx: frameDoc ? { doc: frameDoc, win: frameDoc.defaultView ?? undefined } : undefined,
  });

  return (
    <div class="group/area">
      <div
        class="absolute pointer-events-none rounded-[3px]"
        style={{
          left: x,
          top: y - scrollY,
          width: w,
          height: h,
          background: fill,
          boxShadow: `inset 0 0 0 1.5px ${stroke}`,
          opacity: resolved ? 0.7 : 1,
        }}
        data-anchor-drift={strategy === 'text' ? 'text' : undefined}
      />
      <div
        class="absolute pointer-events-auto"
        style={{
          left: x - 6,
          top: y - scrollY - 6,
          width: 14,
          height: 14,
        }}
        onContextMenu={(e) => openContextMenu(e, areaMenuItems(op))}
      >
        <div class="w-3 h-3 rounded-full ring-2 ring-(--ds-background-100)" style={{ background: stroke }} />
        <AreaCard op={op} class="left-3 top-0">
          {op.attachments && <AttachmentGallery ids={op.attachments} resolveUrl={fileUrl} />}
        </AreaCard>
      </div>
    </div>
  );
}
