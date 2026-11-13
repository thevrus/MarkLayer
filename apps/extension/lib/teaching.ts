import type { ServerMsg } from '@marklayer/types/wire';
import { signal } from '@preact/signals';

type TeachMessage = Extract<ServerMsg, { type: 'teach_highlight' | 'teach_caption' | 'teach_state' | 'teach_control' }>;
export type Highlight = Extract<TeachMessage, { type: 'teach_highlight' }>;
export interface Presentation {
  id: string;
  presenter: string;
  state: 'active' | 'paused';
  highlight?: Highlight;
  caption?: string;
  step?: number;
  total?: number;
  hidden: boolean;
}

export const showTeachingComposer = signal(false);
export const lastTeachingControl = signal<Extract<TeachMessage, { type: 'teach_control' }> | null>(null);
export const presentation = signal<Presentation | null>(null);

/** Temporary messages stay in memory and never enter the annotation queue. */
export function applyTeachingMessage(msg: TeachMessage): void {
  const old = presentation.peek();
  if (msg.type === 'teach_control') {
    lastTeachingControl.value = msg;
    return;
  }
  if (msg.type === 'teach_state' && msg.state === 'ended') {
    if (old?.id === msg.presentationId) presentation.value = null;
    return;
  }
  const current: Presentation =
    old?.id === msg.presentationId
      ? old
      : {
          id: msg.presentationId,
          presenter: msg.peerId,
          state: 'active',
          hidden: false,
        };
  if (msg.type === 'teach_highlight') presentation.value = { ...current, highlight: msg };
  else if (msg.type === 'teach_caption')
    presentation.value = {
      ...current,
      caption: msg.text,
      step: msg.step ?? current.step,
      total: msg.total ?? current.total,
    };
  else
    presentation.value = {
      ...current,
      state: msg.state === 'paused' ? 'paused' : 'active',
      step: msg.step ?? current.step,
      total: msg.total ?? current.total,
    };
}

export function hidePresentation(): void {
  const current = presentation.peek();
  if (current) presentation.value = { ...current, hidden: true };
}

export function openTeaching(): void {
  const current = presentation.peek();
  if (current?.hidden) presentation.value = { ...current, hidden: false };
  else showTeachingComposer.value = true;
}
