import { RETENTION_DAYS } from '@marklayer/brand';
import { DAY_SECONDS } from '../shared/accounts';
import { DEMO_ROOM } from '../shared/demo-room';
import { slackStore } from './integrations/slack-store';
import type { RoomNamespace, SaveMode } from './room-stub';
import { annotationStore, projectStore, uploadStore } from './store';
import { nowInSeconds } from './time';

/**
 * A room's row: minted, saved, and removed in one place, so the three things a
 * deletion must take with it (the row, the OG card, the Slack threads) cannot
 * drift between the cron and a lazy delete at the door. The ops column is the
 * Durable Object's; what is written here is the row around it.
 */

export interface LifecycleEnv {
  DB: D1Database;
  ANNOTATION_ROOM: RoomNamespace;
  OG_BUCKET?: R2Bucket;
  FILE_BUCKET?: R2Bucket;
}

/** The R2 key a room's or project's share card is cached under. */
export const ogCardKey = (id: string) => `${id}.png`;

/** Marketing page cards are hashed, not named, so they are swept by prefix and age rather than by id. */
const PAGE_CARD_PREFIX = 'page/';

/** Seconds-from-now to an absolute unix expiry; `null` and a non-positive number both mean no expiry. */
export function expiresAtFrom(expiresIn: number | null): number | null {
  return expiresIn !== null && expiresIn > 0 ? nowInSeconds() + expiresIn : null;
}

/** R2 caps a batch delete at 1000 keys. */
async function dropKeys({ bucket, keys }: { bucket: R2Bucket | undefined; keys: string[] }): Promise<void> {
  if (!bucket || keys.length === 0) return;
  const batches: Promise<void>[] = [];
  for (let i = 0; i < keys.length; i += 1000) batches.push(bucket.delete(keys.slice(i, i + 1000)));
  await Promise.all(batches);
}

/**
 * The REST save. The ops go to the room, which judges the caller, applies them to
 * whatever it holds and flushes; only then is the row's metadata written here, so a
 * refused save changes nothing. `expiresIn` undefined keeps the link's expiry, `null`
 * clears it, a number sets it (D1). The door refuses a weak id with no row, so
 * `exists: false` always means an id `create` accepts.
 */
export async function saveRoom({
  env,
  id,
  exists,
  userId,
  ops,
  mode,
  url,
  width,
  expiresIn,
}: {
  env: LifecycleEnv;
  id: string;
  exists: boolean;
  userId: string | undefined;
  ops: unknown[];
  mode: SaveMode;
  url: string | null;
  width: number | null;
  expiresIn: number | null | undefined;
}): Promise<'saved' | 'refused'> {
  const annotations = annotationStore(env.DB);
  const expiresAt = expiresIn === undefined ? undefined : expiresAtFrom(expiresIn);
  const stub = env.ANNOTATION_ROOM.get(env.ANNOTATION_ROOM.idFromName(id));
  if (!exists) await annotations.create({ id, ops: [], url, width, expiresAt: expiresAt ?? null });
  if (!(await stub.saveOps({ ops, userId, mode }))) return 'refused';
  if (exists) {
    await annotations.updateMeta({ id, url, width, expiresAt });
    if (url !== null || width !== null || expiresAt !== undefined) await stub.refreshAccess();
  }
  return 'saved';
}

/** Rows, cards and Slack threads of rooms that are gone. Used by the cron and by the door's lazy delete. */
export async function removeRooms({ env, ids }: { env: LifecycleEnv; ids: string[] }): Promise<void> {
  if (ids.length === 0) return;
  const annotations = annotationStore(env.DB);
  await Promise.all(ids.map((id) => annotations.remove(id)));
  await dropKeys({ bucket: env.OG_BUCKET, keys: ids.map(ogCardKey) });
  await slackStore(env.DB).sweepOrphans();
}

/** A project and its card; the pages it bundled are freed to be promoted again. */
export async function removeProjects({ env, ids }: { env: LifecycleEnv; ids: string[] }): Promise<void> {
  if (ids.length === 0) return;
  const projects = projectStore(env.DB);
  await Promise.all(ids.map((id) => projects.remove(id)));
  await annotationStore(env.DB).unlinkProjects(ids);
  await dropKeys({ bucket: env.OG_BUCKET, keys: ids.map(ogCardKey) });
}

/**
 * The retention sweep: everything past its deadline, with the same rule for
 * annotations, projects and uploads (a claimed link keeps what it points at).
 */
export async function sweepExpired({ env }: { env: LifecycleEnv }): Promise<void> {
  const staleBefore = nowInSeconds() - RETENTION_DAYS * DAY_SECONDS;
  const gone = await annotationStore(env.DB).deleteExpired({ unusedSince: staleBefore });
  await dropKeys({ bucket: env.OG_BUCKET, keys: gone.map(ogCardKey) });
  const projects = await projectStore(env.DB).deleteExpired({ unusedSince: staleBefore });
  await annotationStore(env.DB).unlinkProjects(projects);
  await dropKeys({ bucket: env.OG_BUCKET, keys: projects.map(ogCardKey) });
  // After the annotation sweep, which is what orphans them.
  await slackStore(env.DB).sweepOrphans();
  await dropKeys({
    bucket: env.FILE_BUCKET,
    keys: await uploadStore(env.DB).deleteExpired({ unusedSince: staleBefore }),
  });
  await sweepPageCards({
    bucket: env.OG_BUCKET,
    olderThan: new Date(Date.now() - RETENTION_DAYS * DAY_SECONDS * 1000),
  });
}

/** Marketing page cards older than the window. Nothing names them, so age is the only clock they have. */
export async function sweepPageCards({
  bucket,
  olderThan,
}: {
  bucket: R2Bucket | undefined;
  olderThan: Date;
}): Promise<void> {
  if (!bucket) return;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: PAGE_CARD_PREFIX, cursor });
    const stale = listed.objects.filter((o) => o.uploaded < olderThan).map((o) => o.key);
    await dropKeys({ bucket, keys: stale });
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** Seeds the landing page's shared board if it is missing. Idempotent. */
export async function ensureDemoRoom(db: D1Database): Promise<void> {
  const annotations = annotationStore(db);
  if (await annotations.exists(DEMO_ROOM.id)) return;
  await annotations.create({ id: DEMO_ROOM.id, ops: [], url: DEMO_ROOM.url, width: DEMO_ROOM.width, expiresAt: null });
}

/**
 * Wipes the landing page's shared board and keeps it out of the retention sweep.
 * Through the room, never straight in D1: a warm room's in-memory ops would flush the old board back.
 */
export async function resetDemoRoom(env: LifecycleEnv): Promise<void> {
  await ensureDemoRoom(env.DB);
  await env.ANNOTATION_ROOM.get(env.ANNOTATION_ROOM.idFromName(DEMO_ROOM.id)).reset();
  await annotationStore(env.DB).touch(DEMO_ROOM.id);
}
