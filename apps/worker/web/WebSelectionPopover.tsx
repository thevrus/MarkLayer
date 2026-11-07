import { SelectionComposer } from '@ext/components/SelectionComposer';
import type { SelectionRect } from '@ext/lib/types';
import type { CaptureViewport, TargetElement } from '@marklayer/types/ops';
import { pushDeviceOp } from './viewer-state';

interface Props {
  text: string;
  rects: SelectionRect[];
  screenX: number;
  screenY: number;
  target?: TargetElement;
  captureViewport?: CaptureViewport;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
  /** Document holding the watched selection — the proxied page's frame, in the viewer. */
  frameDoc?: Document | null;
  onClose: () => void;
}

export function WebSelectionPopover({
  text,
  rects,
  screenX,
  screenY,
  target,
  captureViewport,
  auto,
  frameDoc,
  onClose,
}: Props) {
  return (
    <SelectionComposer
      text={text}
      rects={rects}
      target={target}
      auto={auto}
      doc={frameDoc}
      anchor={() => ({ x: screenX, y: screenY })}
      captureViewport={() => captureViewport}
      push={pushDeviceOp}
      onClose={onClose}
      fieldClass="max-h-100"
      fieldName="comment"
    />
  );
}
