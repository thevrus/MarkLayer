import type { AnnotationOp } from '@marklayer/types/ops';
import type { ComponentChildren } from 'preact';

/** The comment-only embed does not capture extension-only live diagnostics. */
export function DiagnosisAction(_props: { op: AnnotationOp }): ComponentChildren {
  return null;
}
