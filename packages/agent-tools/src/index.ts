import { mcpEndpoint, parseRoomRef as roomIdIn, uploadPath } from '@marklayer/brand/links';
import type { AnnotationOp, CommentStatus, DrawOp, QuestionOp, StepOp } from '@marklayer/types/ops';
import { isRootAnnotation, orderedSteps, resolveOpStatus, tallyQuestion } from '@marklayer/types/ops';
import { agentTaskCommandSchema } from '@marklayer/types/wire';
import { buildStoredDiagnosis } from './diagnosis';
import { formatStyleEdit } from './prompt';
import type { PreviewCreated, RoomOps } from './room-core';
import {
  AttachmentInput,
  CompleteStepInput,
  CreateInput,
  DismissInput,
  IdInput,
  isToolName,
  ListInput,
  NEEDS_LIVE_ROOM,
  NEEDS_ROOM,
  type PreviewRequest,
  QuestionInput,
  ReplyInput,
  ResolveInput,
  SetStepsInput,
  SharePreviewInput,
  SuggestInput,
  TeachEndInput,
  TeachStartInput,
  TeachStepInput,
  type ToolName,
  WatchInput,
} from './tools';

export * from './diagnosis';
export * from './room-core';
export * from './server-card';
export * from './tools';

/**
 * Everything about MarkLayer's agent tools that is not a transport: the tool table,
 * the room core, the annotation projection and the dispatch. Two runtimes serve these
 * tools, stdio (`apps/mcp`) and Streamable HTTP (the Worker). No MCP SDK appears here
 * on purpose: they bind to different libraries, so what is shared is the contract,
 * not the wiring.
 */

/** Builds the `target` block once a schema carrying `targetTripleCheck` has already guaranteed all-or-none. */
function targetFromParts({
  selector,
  tag,
  markdown,
}: {
  selector?: string;
  tag?: string;
  markdown?: string;
}): { selector: string; tag: string; markdown: string } | undefined {
  return selector && tag && markdown ? { selector, tag, markdown } : undefined;
}

/** An attachment's upload id, resolved to a URL an agent can fetch on its own. */
function attachmentUrls(ids: string[] | undefined, apiBase: string): string[] {
  return (ids ?? []).map((id) => `${apiBase}${uploadPath(id)}`);
}

/**
 * Project an annotation op down to the agent-facing JSON shape. Each kind keeps
 * its own discriminator and surfaces the `target` element context (selector +
 * markup) so the agent has everything it needs to act on the change without
 * round-tripping back to the page. `apiBase` is the room's own origin, so a
 * screenshot attachment resolves to a URL the agent can fetch regardless of
 * which MarkLayer deployment this room lives on.
 */
export function projectAnnotation(op: AnnotationOp, apiBase: string) {
  const common = {
    id: op.id,
    layerId: op.layerId ?? 'default',
    kind: op.tool,
    status: resolveOpStatus(op),
    author: op.author ?? null,
    assignee: op.assignee ?? null,
    assignedAgent: op.assignedAgent ?? null,
    // Who the note names. An agent reading a thread has to know that "@Vadym can
    // you check this" is addressed to a person, not to it.
    mentions: op.mentions?.map((m) => m.name) ?? [],
    ts: op.ts,
  };
  if (op.tool === 'comment') {
    return {
      ...common,
      text: op.text,
      position: { x: op.x, y: op.y },
      url: op.meta?.url ?? null,
      // Console output the page had when this was written; often the bug itself.
      pageErrors: op.meta?.errors ?? [],
      target: op.target ?? null,
      ...(op.visualContext ? { visualContext: op.visualContext } : {}),
      ...(op.diagnosis ? { diagnosis: op.diagnosis } : {}),
      attachments: attachmentUrls(op.attachments, apiBase),
      // The recording behind `text`, which is its transcript and may be empty if transcription failed.
      voice: op.voice ? attachmentUrls([op.voice], apiBase)[0] : null,
      // A recorded camera or screen clip. Like `voice`, its narration is transcribed into `text`;
      // a silent clip leaves `text` as only what was typed beside it.
      video: op.video ? attachmentUrls([op.video], apiBase)[0] : null,
    };
  }
  if (op.tool === 'area') {
    return {
      ...common,
      comment: op.comment ?? null,
      rect: { x: op.startX, y: op.startY, width: op.endX - op.startX, height: op.endY - op.startY },
      target: op.target ?? null,
      ...(op.diagnosis ? { diagnosis: op.diagnosis } : {}),
      // The marked-up screenshot of the area, when the reviewer drew on it.
      attachments: attachmentUrls(op.attachments, apiBase),
    };
  }
  if (op.tool === 'selection') {
    return {
      ...common,
      text: op.text,
      // A proposed replacement for `text` — present when the reviewer asked for a
      // copy edit rather than leaving a note, so it can be applied as a diff.
      suggestion: op.suggestion ?? null,
      comment: op.comment ?? null,
      rects: op.rects,
      target: op.target ?? null,
      ...(op.diagnosis ? { diagnosis: op.diagnosis } : {}),
    };
  }
  return {
    ...common,
    selector: op.selector,
    tag: op.tag,
    comment: op.comment ?? null,
    markdown: op.markdown,
    rect: op.rect,
    // CSS the reviewer already tried live on the element, as `property: from -> to` lines to port into source.
    styleEdits: op.styleEdits?.map(formatStyleEdit) ?? [],
    // id, classes, attributes, visible text, key styles and component chain, so nothing has to be parsed out of `markdown`.
    details: op.details ?? null,
    ...(op.diagnosis ? { diagnosis: op.diagnosis } : {}),
  };
}

export type ToolContent = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
};

export function ok(data: unknown): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function err(message: string): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

/**
 * A mutator returned false. It has two causes worth telling apart: the room
 * refuses this peer's writes, or the id genuinely is not there. Reporting the
 * first as "not found" sent an agent hunting for a missing annotation when the
 * real answer was that the owner made the link view-only.
 */
function mutationErr({ room, id }: { room: { viewOnly: boolean }; id: string }): ToolContent {
  return room.viewOnly
    ? err(`this link is view-only, so nothing can be changed through it: ${id}`)
    : err(`annotation not found: ${id}`);
}

export function fail(parseError: { issues: { path: PropertyKey[]; message: string }[] }): ToolContent {
  const flat = parseError.issues
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '<root>'}: ${i.message}`)
    .join('; ');
  return err(`invalid arguments: ${flat}`);
}

/**
 * Run one tool. `room` is null until something is connected, which only a tool that
 * makes a room can work with. `null` means the name is not one of these: the caller
 * owns anything transport-specific, such as stdio's connect_room.
 */
export async function callTool({
  name,
  args,
  room,
  apiBase,
  createPreview,
}: {
  name: string;
  args: unknown;
  room: RoomOps | null;
  apiBase: string;
  createPreview: CreatePreview;
}): Promise<ToolContent | null> {
  if (name === 'marklayer_share_preview') return sharePreview({ args, createPreview, apiBase });
  if (!isToolName(name)) return null;
  if (room) return workRoom({ name, args, room, apiBase });
  return NEEDS_ROOM.has(name)
    ? err('no room connected — call marklayer_connect_room first or set MARKLAYER_ROOM in the environment')
    : null;
}

async function workRoom({
  name,
  args,
  room,
  apiBase,
}: {
  name: ToolName;
  args: unknown;
  room: RoomOps;
  apiBase: string;
}): Promise<ToolContent | null> {
  // Checked once, up front: a case that forgot it was how watch looped forever on an empty batch.
  if (NEEDS_LIVE_ROOM.has(name)) {
    const dead = room.checkLive();
    if (dead) return err(dead);
  }

  switch (name) {
    case 'marklayer_task': {
      const parsed = agentTaskCommandSchema.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (!room.taskCommand) return err('task coordination is unavailable on this connection');
      const result = await room.taskCommand(parsed.data);
      return result.ok ? ok(result) : err('task transition refused or no eligible queued task');
    }
    case 'teach_start': {
      const parsed = TeachStartInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const started = await room.teachStart(parsed.data);
      return started ? ok(started) : err('could not start the presentation');
    }

    case 'teach_step': {
      const parsed = TeachStepInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (parsed.data.annotationId && !room.getAnnotation(parsed.data.annotationId)) {
        return err(`annotation not found: ${parsed.data.annotationId}`);
      }
      return (await room.teachStep(parsed.data)) ? ok({ sent: true }) : err('could not send the teaching step');
    }

    case 'teach_end': {
      const parsed = TeachEndInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      return (await room.teachEnd(parsed.data.presentationId))
        ? ok({ ended: true })
        : err('could not end the presentation');
    }

    case 'marklayer_read_page': {
      const page = await room.readPage();
      if (!page) return err('could not read the page — it may be unreachable or not HTML');
      if (page.clientRendered) {
        return ok({
          ...page,
          note: 'This page renders client-side, so only its shell was served. The copy is not in the HTML — ask a human to annotate the parts you should review, or use a browser tool if you have one.',
        });
      }
      return ok(page);
    }

    case 'marklayer_room_info':
      return ok({
        roomId: room.roomId,
        ...room.getMeta(),
        exec_mode: room.getMeta().execMode ?? 'pair',
        layers: room.listLayers?.() ?? [],
      });

    case 'marklayer_list_annotations': {
      const parsed = ListInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const ann = room.listAnnotations({ status: parsed.data.status });
      return ok({ count: ann.length, annotations: ann.map((op) => projectAnnotation(op, apiBase)) });
    }

    case 'marklayer_get_annotation': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const found = room.getAnnotation(parsed.data.id);
      if (!found) return err(`annotation not found: ${parsed.data.id}`);
      return ok({
        ...projectAnnotation(found.op, apiBase),
        dismissReason: found.op.dismissReason ?? null,
        replies: found.replies.map((r) => ({
          id: r.id,
          text: r.text,
          author: r.author ?? null,
          ts: r.ts,
          attachments: attachmentUrls(r.attachments, apiBase),
        })),
      });
    }

    case 'marklayer_diagnose': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const found = room.getAnnotation(parsed.data.id);
      if (!found) return err(`annotation not found: ${parsed.data.id}`);
      // A live package contains DOM hit-testing the MCP worker cannot reproduce. Keep that
      // evidence; otherwise write a clearly partial package from the stored annotation only.
      const preserveLiveCapture = found.op.diagnosis?.source === 'live-page';
      const diagnosis = preserveLiveCapture ? found.op.diagnosis! : buildStoredDiagnosis(found.op);
      if (!preserveLiveCapture && !(await room.setDiagnosis(parsed.data.id, diagnosis)))
        return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, diagnosis, saved: !preserveLiveCapture });
    }

    case 'marklayer_read_diagnosis': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const found = room.getAnnotation(parsed.data.id);
      if (!found) return err(`annotation not found: ${parsed.data.id}`);
      if (!found.op.diagnosis) return err('no diagnosis saved — call marklayer_diagnose first');
      return ok({ id: parsed.data.id, diagnosis: found.op.diagnosis });
    }

    case 'marklayer_read_attachment': {
      const parsed = AttachmentInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const found = room.getAnnotation(parsed.data.id);
      if (!found) return err('annotation not found');
      const ids = [found.op, ...found.replies].flatMap((op) => ('attachments' in op ? (op.attachments ?? []) : []));
      if (!ids.includes(parsed.data.attachmentId)) return err('attachment is not attached to this annotation');
      try {
        const response = await fetch(`${apiBase}${uploadPath(parsed.data.attachmentId)}`);
        const mimeType = response.headers.get('content-type')?.split(';')[0] ?? '';
        const length = Number(response.headers.get('content-length') ?? 0);
        if (
          !response.ok ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType) ||
          length > 8_000_000
        )
          return err('image unavailable or unsupported');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 8_000_000) return err('image exceeds size limit');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { content: [{ type: 'image', data: btoa(binary), mimeType }] };
      } catch {
        return err('could not read image; do not claim to have seen it');
      }
    }

    case 'marklayer_watch_annotations': {
      const parsed = WatchInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const batch = await room.watch(parsed.data);
      return ok({
        count: batch.length,
        events: batch.map((event) =>
          event.kind === 'teach_control' || event.kind === 'task_update'
            ? event
            : {
                kind: event.kind,
                annotation: projectAnnotation(event.op, apiBase),
                // The reply that handed it over is the instruction — surfaced beside
                // the thread so the agent reads what was asked, not just what exists.
                ...(event.reply ? { request: { from: event.reply.author ?? null, text: event.reply.text } } : {}),
              },
        ),
      });
    }

    case 'marklayer_acknowledge': {
      const parsed = IdInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (!(await room.acknowledge(parsed.data.id))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'in_progress' });
    }

    case 'marklayer_resolve': {
      if (room.getMeta().execMode === 'guide') return err('Guide mode does not allow agents to resolve annotations');
      const parsed = ResolveInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (!(await room.resolve(parsed.data.id, parsed.data.summary))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'resolved' });
    }

    case 'marklayer_dismiss': {
      if (room.getMeta().execMode === 'guide') return err('Guide mode does not allow agents to dismiss annotations');
      const parsed = DismissInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (!(await room.dismiss(parsed.data.id, parsed.data.reason))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, status: 'dismissed', reason: parsed.data.reason });
    }

    case 'marklayer_reply': {
      const parsed = ReplyInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      if (!(await room.reply(parsed.data.id, parsed.data.text))) return mutationErr({ room, id: parsed.data.id });
      return ok({ id: parsed.data.id, replied: true });
    }

    case 'marklayer_create_annotation': {
      const parsed = CreateInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const { text, x, y, priority, selector, tag, markdown } = parsed.data;
      const target = targetFromParts({ selector, tag, markdown });
      // An element pin sits on the element and follows it; x/y are only the stale-selector fallback.
      const created = await room.create({
        text,
        x: x ?? 0,
        y: y ?? 0,
        priority,
        target: target && { ...target, offsetX: 0, offsetY: 0 },
      });
      if (!created) return err(createFailure({ room, what: 'annotation' }));
      return ok({ id: created.id, status: 'open' });
    }

    case 'marklayer_suggest_edit': {
      if (room.getMeta().execMode === 'guide') return err('Guide mode does not allow agents to suggest edits');
      const parsed = SuggestInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const { text, suggestion, rects, comment, priority, selector, tag, markdown } = parsed.data;
      const created = await room.suggestEdit({
        text,
        suggestion,
        rects,
        comment,
        priority,
        target: targetFromParts({ selector, tag, markdown }),
      });
      if (!created) return err(createFailure({ room, what: 'suggestion' }));
      return ok({ id: created.id, status: 'open' });
    }

    case 'marklayer_set_next_steps': {
      const parsed = SetStepsInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      // A step pointing at no annotation would render a link to nothing.
      const known = new Set(room.listAnnotations().map((op) => op.id));
      const unknown = parsed.data.steps.flatMap((step) => (step.annotationIds ?? []).filter((id) => !known.has(id)));
      if (unknown.length) return err(`unknown annotation ids: ${unknown.join(', ')}`);
      const written = await room.setNextSteps(parsed.data.steps);
      if (!written) return err(createFailure({ room, what: 'checklist' }));
      return ok({ steps: written.ids.map((id, i) => ({ id, text: parsed.data.steps[i]?.text ?? '', done: false })) });
    }

    case 'marklayer_complete_next_step': {
      const parsed = CompleteStepInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const { id, done = true } = parsed.data;
      if (!room.listOps().some((op) => op.tool === 'step' && op.id === id)) return err(`step not found: ${id}`);
      if (!(await room.setStepDone({ id, done }))) return mutationErr({ room, id });
      return ok({ id, done });
    }

    case 'marklayer_ask': {
      const parsed = QuestionInput.safeParse(args);
      if (!parsed.success) return fail(parsed.error);
      const created = await room.ask(parsed.data);
      if (!created) return err(createFailure({ room, what: 'question' }));
      return ok({ id: created.id, prompt: parsed.data.prompt, options: parsed.data.options });
    }

    case 'marklayer_get_feedback':
      return ok(feedbackSummary({ ops: room.listOps(), apiBase }));

    // Answered before a room is needed (share_preview) or by the transport itself (connect_room).
    case 'marklayer_connect_room':
    case 'marklayer_share_preview':
      return null;

    default: {
      // A tool in TOOL_DEFS with no case here fails the build instead of answering "unknown tool".
      const unhandled: never = name;
      return unhandled;
    }
  }
}

/** A create returned nothing: say which of the two reasons it was. */
function createFailure({ room, what }: { room: RoomOps; what: string }): string {
  return room.viewOnly
    ? `this link is view-only, so nothing can be created through it`
    : `could not create the ${what} — the room connection may be down`;
}

/** A poll as an agent reads it: each option with its votes, and who cast them. */
function projectQuestion({ question, ops }: { question: QuestionOp; ops: readonly DrawOp[] }) {
  const tally = tallyQuestion({ question, ops });
  const ballots = [...tally.ballots.values()];
  return {
    id: question.id,
    prompt: question.prompt,
    author: question.author ?? null,
    total: tally.total,
    options: question.options.map((label, i) => ({
      label,
      votes: tally.counts[i] ?? 0,
      voters: ballots.filter((b) => b.option === i).map((b) => b.name),
    })),
  };
}

const projectStep = (step: StepOp) => ({
  id: step.id,
  text: step.text,
  done: step.done ?? false,
  doneBy: step.doneBy ?? null,
  annotationIds: step.annotationIds ?? [],
});

/** `marklayer_get_feedback`: the room's state an agent plans from, in one answer. */
function feedbackSummary({ ops, apiBase }: { ops: readonly DrawOp[]; apiBase: string }) {
  const annotations = ops.filter(isRootAnnotation);
  const byStatus: Record<CommentStatus, number> = { open: 0, in_progress: 0, resolved: 0, approved: 0, dismissed: 0 };
  for (const op of annotations) byStatus[resolveOpStatus(op)] += 1;
  const steps = orderedSteps(ops);
  return {
    annotations: {
      total: annotations.length,
      byStatus,
      open: annotations.filter((op) => resolveOpStatus(op) === 'open').map((op) => projectAnnotation(op, apiBase)),
    },
    nextSteps: { done: steps.filter((s) => s.done).length, total: steps.length, steps: steps.map(projectStep) },
    questions: ops
      .filter((op): op is QuestionOp => op.tool === 'question')
      .map((question) => projectQuestion({ question, ops })),
  };
}

/** How a transport makes a room: it knows the way to the share API, the dispatch does not. */
type CreatePreview = (request: PreviewRequest) => Promise<PreviewCreated | { error: string }>;

/** Makes a room rather than working one, so stdio can answer it before anything is connected. */
async function sharePreview({
  args,
  createPreview,
  apiBase,
}: {
  args: unknown;
  createPreview: CreatePreview;
  apiBase: string;
}): Promise<ToolContent> {
  const parsed = SharePreviewInput.safeParse(args);
  if (!parsed.success) return fail(parsed.error);
  const created = await createPreview(parsed.data);
  if ('error' in created) return err(created.error);
  return ok({
    id: created.id,
    url: created.url,
    mcpUrl: mcpEndpoint({ origin: apiBase, roomId: created.id }),
    version: created.version,
    previous: created.previous,
  });
}

/** The brand's reading of a room reference, throwing the reason: every caller reports it straight to the agent. */
export function parseRoomRef(input: string): string {
  const id = roomIdIn(input);
  if (id) return id;
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty room reference');
  throw new Error(
    /^https?:\/\//.test(trimmed) ? `could not extract room id from URL: ${input}` : `invalid room reference: ${input}`,
  );
}
