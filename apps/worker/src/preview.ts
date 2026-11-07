import { agentQuestionOp, type PreviewCreated, type PreviewRequest, parseRoomRef } from '@marklayer/agent-tools';
import { nanoid } from 'nanoid';
import { roomAccess } from './lock/gate';
import { annotationStore } from './store';

/**
 * Open a review room for a preview build. One path for the share API and the
 * remote MCP endpoint, so a room made either way carries the same fields and
 * links into a version chain the same way.
 *
 * `fallbackPrevious` is the room the caller is already working in: an agent
 * that shares a new build from inside the last one's room chains to it without
 * having to name it.
 */
export async function createPreviewRoom({
  db,
  request,
  agentId,
  origin,
  headers,
  id = nanoid(),
  fallbackPrevious = null,
}: {
  db: D1Database;
  request: PreviewRequest;
  agentId: string;
  origin: string;
  /** The caller's request headers, checked against a named previous room's password. */
  headers: Headers;
  id?: string;
  fallbackPrevious?: string | null;
}): Promise<PreviewCreated | { error: string; taken?: boolean }> {
  let previousId = fallbackPrevious;
  if (request.previous) {
    try {
      previousId = parseRoomRef(request.previous);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'invalid previous room' };
    }
    // Naming a room is the proof of holding it, and a protected room's id alone proves nothing.
    if (previousId !== fallbackPrevious && !(await roomAccess({ db, id: previousId, headers })).open) {
      return { error: 'the previous room is password-protected; unlock it or send its password' };
    }
  }
  const ops = (request.questions ?? []).map((question) => agentQuestionOp({ id: nanoid(), question, agentId }));
  const result = await annotationStore(db).createPreview({
    id,
    ops,
    previousId,
    preview: {
      url: request.url,
      title: request.title,
      note: request.note ?? null,
      repo: request.repo ?? null,
      branch: request.branch ?? null,
      sha: request.sha ?? null,
    },
  });
  if (!result.created) {
    return result.reason === 'taken'
      ? { error: 'that share id is already a room', taken: true }
      : { error: 'share id too short to create a room at' };
  }
  return { id, url: `${origin}/s/${id}`, version: result.version, previous: result.previousId };
}
