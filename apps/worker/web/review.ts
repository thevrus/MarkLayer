import { localUser, signedBy } from '@ext/lib/identity';
import { operations, patchOp, pushOp } from '@ext/lib/ops';
import { type Ballot, type DrawOp, orderedSteps, type QuestionOp, type StepOp } from '@marklayer/types/ops';
import { computed, effect, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { z } from 'zod/mini';
import { API_BASE, annotationId } from './projects';
import { showAnnotationPanel } from './ui-state';
import { compactChrome } from './viewer-state';

/** The room's review state: the agent's checklist and the polls, derived from the op stream like guides are. */
export const reviewSteps = computed(() => orderedSteps(operations.value));
export const reviewQuestions = computed(() =>
  operations.value.filter((op): op is QuestionOp => op.tool === 'question'),
);

const versionRef = z.nullable(
  z.object({ id: z.string(), version: z.nullable(z.number()), sha: z.nullable(z.string()) }),
);
const previewInfoSchema = z.object({
  title: z.nullable(z.string()),
  note: z.nullable(z.string()),
  repo: z.nullable(z.string()),
  branch: z.nullable(z.string()),
  sha: z.nullable(z.string()),
  version: z.nullable(z.number()),
  previous: versionRef,
  next: versionRef,
});
export type PreviewInfo = z.infer<typeof previewInfoSchema>;

/** What `GET /api/:id/versions` said about this room; null until it answers, or on a room that is not a preview. */
export const previewInfo = signal<PreviewInfo | null>(null);

effect(() => {
  const id = annotationId.value;
  previewInfo.value = null;
  if (!id) return;
  fetch(`${API_BASE}${id}/versions`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => {
      const parsed = previewInfoSchema.safeParse(body);
      // A slow answer for a page the project tabs have already left must not land on the next one.
      if (parsed.success && annotationId.peek() === id) previewInfo.value = parsed.data;
    })
    .catch(() => {});
});

/** Whether the review section has anything to show: steps, a poll, or the preview's note. */
export const hasReviewContent = computed(
  () => reviewSteps.value.length > 0 || reviewQuestions.value.length > 0 || Boolean(previewInfo.value?.note),
);

// A room that arrives with review content opens the comments panel once, not
// whenever: closing it is a choice. A phone gets it on request only.
let openedForReview = false;
effect(() => {
  if (openedForReview || !hasReviewContent.value || compactChrome.value) return;
  openedForReview = true;
  showAnnotationPanel.value = true;
});

/** Revoting patches your own ballot rather than adding one, so the stream does not grow per click. */
export function castVote({ question, option, mine }: { question: QuestionOp; option: number; mine?: Ballot }) {
  if (mine) {
    if (mine.option !== option) patchOp({ opId: mine.opId, patch: { option, ts: Date.now(), author: localUser.name } });
    return;
  }
  const op: DrawOp = {
    id: nanoid(),
    tool: 'vote',
    questionId: question.id,
    option,
    voter: localUser.id,
    ts: Date.now(),
    color: localUser.color,
    lineWidth: 1,
    ...signedBy(),
  };
  pushOp(op);
}

export function toggleStep(step: StepOp) {
  const done = !step.done;
  patchOp({ opId: step.id, patch: { done, doneBy: done ? localUser.name : null } });
}

export function askQuestion({ prompt, options }: { prompt: string; options: string[] }) {
  const op: QuestionOp = {
    id: nanoid(),
    tool: 'question',
    prompt,
    options,
    ts: Date.now(),
    color: localUser.color,
    lineWidth: 1,
    ...signedBy(),
  };
  pushOp(op);
}
