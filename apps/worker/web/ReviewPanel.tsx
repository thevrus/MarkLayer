import { Checkbox } from '@base-ui/react/checkbox';
import { geist } from '@ext/lib/geist';
import { comments, focusedAnnotationId, localUser, operations, showAnnotationPanel } from '@ext/lib/state';
import {
  cn,
  MAX_QUESTION_OPTIONS,
  MAX_QUESTION_TEXT,
  MIN_QUESTION_OPTIONS,
  type QuestionOp,
  type StepOp,
  tallyQuestion,
} from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { Check } from 'lucide-preact';
import { capture } from './analytics';
import {
  askQuestion,
  castVote,
  hasReviewContent,
  previewInfo,
  reviewQuestions,
  reviewSteps,
  toggleStep,
} from './review';
import { isReadonly } from './signals';

/** `#3` for a comment pin, so a step points at the thread a reviewer already knows by number. */
function annotationLabel(id: string): string {
  const pin = comments.value.find((c) => c.id === id && !c.parentId);
  return pin ? `#${pin.num}` : 'note';
}

function StepRow({ step }: { step: StepOp }) {
  const done = step.done ?? false;
  return (
    <li class="flex items-start gap-2.5 py-1.5">
      <Checkbox.Root
        checked={done}
        disabled={isReadonly.value}
        onCheckedChange={(checked: boolean) => {
          toggleStep(step);
          capture('review_step_toggled', { done: checked });
        }}
        aria-label={done ? `Mark "${step.text}" not done` : `Mark "${step.text}" done`}
        className={cn(
          'mt-0.5 size-4 shrink-0 grid place-items-center rounded-sm border appearance-none cursor-pointer p-0',
          'border-(--ds-gray-alpha-500) bg-(--ds-background-100) transition-colors duration-150',
          'data-checked:bg-(--ds-gray-1000) data-checked:border-(--ds-gray-1000)',
          'data-disabled:cursor-default',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
        )}
      >
        <Checkbox.Indicator className="text-(--ds-background-100) grid place-items-center">
          <Check size={12} strokeWidth={2.5} aria-hidden="true" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <div class="min-w-0 flex-1">
        <p class={cn('m-0 text-ui leading-body', done ? 'text-(--ds-gray-900) line-through' : 'text-(--ds-gray-1000)')}>
          {step.text}
        </p>
        {(step.annotationIds?.length || (done && step.doneBy)) && (
          <div class="flex flex-wrap items-center gap-x-2 mt-0.5">
            {step.annotationIds?.map((id) => (
              <button
                key={id}
                type="button"
                class={cn(geist.bareBtn, geist.bareBtnQuiet)}
                onClick={() => {
                  showAnnotationPanel.value = true;
                  focusedAnnotationId.value = id;
                }}
              >
                {annotationLabel(id)}
              </button>
            ))}
            {done && step.doneBy && <span class="text-meta text-(--ds-gray-900)">by {step.doneBy}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function QuestionCard({ question }: { question: QuestionOp }) {
  const { counts, total, ballots } = tallyQuestion({ question, ops: operations.value });
  const mine = ballots.get(localUser.id);
  return (
    <div class="py-2">
      <p class="m-0 mb-1.5 text-ui font-medium text-(--ds-gray-1000)">{question.prompt}</p>
      <div class="flex flex-col gap-1">
        {question.options.map((label, option) => {
          const votes = counts[option] ?? 0;
          const share = total ? votes / total : 0;
          const chosen = mine?.option === option;
          return (
            <button
              key={option}
              type="button"
              disabled={isReadonly.value}
              aria-pressed={chosen}
              onClick={() => {
                castVote({ question, option, mine });
                capture('review_vote_cast', { changed: mine !== undefined });
              }}
              class={cn(
                'relative flex items-center justify-between gap-3 h-8 px-2.5 rounded-md overflow-hidden',
                'appearance-none border-none bg-(--ds-gray-alpha-100) text-left cursor-pointer',
                'text-ui text-(--ds-gray-1000) transition-colors duration-150 hover:bg-(--ds-gray-alpha-200)',
                'disabled:cursor-default disabled:hover:bg-(--ds-gray-alpha-100)',
                'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
              )}
            >
              <span
                aria-hidden="true"
                class="absolute inset-y-0 left-0 bg-(--ds-gray-alpha-300) transition-[width] duration-300 ease-out"
                style={{ width: `${share * 100}%` }}
              />
              <span class={cn('relative min-w-0 truncate', chosen && 'font-medium')}>{label}</span>
              <span class="relative flex items-center gap-1 shrink-0 text-meta tabular-nums text-(--ds-gray-900)">
                {chosen && <Check size={12} strokeWidth={2} aria-label="Your vote" />}
                {votes}
              </span>
            </button>
          );
        })}
      </div>
      <p class="m-0 mt-1 text-meta text-(--ds-gray-900)">
        {total === 1 ? '1 vote' : `${total} votes`}
        {question.author ? `, asked by ${question.author}` : ''}
      </p>
    </div>
  );
}

function QuestionComposer({ onDone }: { onDone: () => void }) {
  const prompt = useSignal('');
  const options = useSignal<string[]>(['', '']);
  const filled = options.value.map((o) => o.trim()).filter(Boolean);
  const ready = prompt.value.trim().length > 0 && filled.length >= MIN_QUESTION_OPTIONS;
  // `geist.field` on the input itself, not `geist.input` too: its `border-none` would erase the field's border.
  const input = cn(
    geist.field,
    'w-full min-w-0 px-2.5 outline-none text-ui text-(--ds-gray-1000) placeholder:text-(--ds-gray-700)',
  );
  return (
    <form
      class="flex flex-col gap-1.5 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        askQuestion({ prompt: prompt.value.trim(), options: filled });
        capture('review_question_asked', { options: filled.length });
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onDone();
      }}
    >
      <input
        // The form only exists because "Ask a question" was just pressed, so the first field is where the hand goes.
        // biome-ignore lint/a11y/noAutofocus: opened by an explicit click, not on page load
        autoFocus
        class={input}
        placeholder="Ask the room…"
        maxLength={MAX_QUESTION_TEXT}
        value={prompt.value}
        onInput={(e) => (prompt.value = e.currentTarget.value)}
        aria-label="Question"
      />
      {options.value.map((value, i) => (
        <input
          key={i}
          class={input}
          placeholder={`Option ${i + 1}`}
          maxLength={MAX_QUESTION_TEXT}
          value={value}
          onInput={(e) => {
            const next = [...options.value];
            next[i] = e.currentTarget.value;
            options.value = next;
          }}
          aria-label={`Option ${i + 1}`}
        />
      ))}
      <div class="flex items-center justify-between mt-0.5">
        {options.value.length < MAX_QUESTION_OPTIONS ? (
          <button
            type="button"
            class={cn(geist.actionBtn, geist.ctlIdle)}
            onClick={() => (options.value = [...options.value, ''])}
          >
            Add option
          </button>
        ) : (
          <span />
        )}
        <div class="flex items-center gap-2">
          <button type="button" class={cn(geist.actionBtn, geist.ctlIdle)} onClick={onDone}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            class={cn(
              geist.ctlOn,
              'inline-flex items-center justify-center h-6 px-2.5 rounded-md border-none cursor-pointer outline-none',
              'text-meta font-medium disabled:pointer-events-none disabled:opacity-50',
              'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
            )}
          >
            Ask
          </button>
        </div>
      </div>
    </form>
  );
}

/** The agent's checklist and the room's polls, at the top of the comments panel: one place for everything the room says. */
export function ReviewSection() {
  const composing = useSignal(false);
  const readonly = isReadonly.value;
  const steps = reviewSteps.value;
  const questions = reviewQuestions.value;
  const info = previewInfo.value;
  const doneCount = steps.filter((s) => s.done).length;
  // A guest with nothing to read gets no section; an editor always gets the question composer.
  if (!hasReviewContent.value && readonly) return null;
  return (
    <div class="border-b border-(--ds-gray-alpha-400)">
      {info?.note && <p class="m-0 px-4 pt-3 text-ui leading-body text-(--ds-gray-900)">{info.note}</p>}

      {steps.length > 0 && (
        <section class="px-4 pt-2 pb-2">
          <div class={cn(geist.sectionLabel, 'flex justify-between pt-1')}>
            <span>Next steps</span>
            <span class="tabular-nums">
              {doneCount} of {steps.length}
            </span>
          </div>
          <ol class="m-0 p-0 list-none">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        </section>
      )}

      {(questions.length > 0 || !readonly) && (
        <section class="px-4 pt-2 pb-3">
          {steps.length > 0 && <div class={cn(geist.divider, '-mx-4 mb-2')} />}
          {questions.length > 0 && <div class={cn(geist.sectionLabel, 'pt-1')}>Questions</div>}
          {questions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
          {!readonly &&
            (composing.value ? (
              <QuestionComposer onDone={() => (composing.value = false)} />
            ) : (
              <button
                type="button"
                class={cn(geist.actionBtn, geist.ctlIdle, 'mt-1')}
                onClick={() => (composing.value = true)}
              >
                Ask a question
              </button>
            ))}
        </section>
      )}
    </div>
  );
}
