import { RETENTION_DAYS } from '@marklayer/brand';
import { z } from 'zod/mini';

/** Seconds in a day. Every expiry here and in the dashboard is a multiple of it. */
export const DAY_SECONDS = 24 * 60 * 60;

/**
 * The longest expiry anyone can set, 30 days. One ceiling for both ways of
 * asking: the owner's `ownerExpiresIn` below, and the share API's anonymous
 * `expires_in` (`apps/worker/src/api.ts`), which advertised this number in its
 * OpenAPI description long before anything enforced it. Declared above the
 * schema that uses it: `zod/mini` evaluates the bound at definition time.
 */
export const MAX_EXPIRES_IN_SECONDS = 30 * DAY_SECONDS;

/** A signed-in person, as the server holds them and as `/auth/me` returns them. */
export const sessionUserSchema = z.object({ id: z.string(), email: z.string() });
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * Who a link lets edit. `edit` is the pre-settings behaviour: everyone holding the
 * id may draw. `view` leaves only the owner's own session able to; the room
 * rejects everyone else's ops rather than trusting the toolbar to stay hidden.
 */
export const linkAccessSchema = z.enum(['edit', 'view']);
export type LinkAccess = z.infer<typeof linkAccessSchema>;

/**
 * May this session edit? Two independent enforcement points ask — the realtime
 * room per socket, and the REST write path per request — so the rule itself is
 * one definition rather than one per gate.
 */
export function canEditLink({
  access,
  ownerId,
  userId,
}: {
  access: LinkAccess;
  ownerId: string | null;
  userId: string | null | undefined;
}): boolean {
  return access !== 'view' || (userId != null && userId === ownerId);
}

/**
 * The earlier of a link's own expiry and its owner's — whichever deletes it
 * first. Every read/write gate must check this, not `expiresAt` alone, or an
 * owner-set deadline is silently ignored until the next retention sweep.
 * `deletionDeadline` folds the idle window on top of the same answer.
 */
export function effectiveExpiresAt({
  expiresAt,
  ownerExpiresAt,
}: {
  expiresAt: number | null;
  ownerExpiresAt: number | null;
}): number | null {
  if (expiresAt === null) return ownerExpiresAt;
  if (ownerExpiresAt === null) return expiresAt;
  return Math.min(expiresAt, ownerExpiresAt);
}

/** A share link someone has claimed. `url` is null for an upload with no source page. */
export const ownedLinkSchema = z.object({
  id: z.string(),
  url: z.nullable(z.string()),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
  expiresAt: z.nullable(z.number()),
  access: linkAccessSchema,
  /** Set by the owner in Settings; separate from `expiresAt`, which anonymous re-saves overwrite. */
  ownerExpiresAt: z.nullable(z.number()),
  /** The owner's folder it is filed in, or null when unfiled. */
  folderId: z.nullable(z.string()),
  /** Whether opening the link asks for a password. Never the password or its hash. */
  passwordProtected: z.boolean(),
});
export type OwnedLink = z.infer<typeof ownedLinkSchema>;

export const MAX_FOLDER_NAME_LENGTH = 60;
/** What a folder is called, already trimmed — an all-space name is not one. */
export const folderNameSchema = z.string().check(z.trim(), z.minLength(1), z.maxLength(MAX_FOLDER_NAME_LENGTH));
export const folderSchema = z.object({ id: z.string(), name: z.string(), createdAt: z.number() });
export type Folder = z.infer<typeof folderSchema>;
export const createFolderResponseSchema = z.object({ folder: folderSchema });
export const foldersResponseSchema = z.object({ folders: z.array(folderSchema) });
/** `POST /auth/folders` and `PATCH /auth/folders/:id`. */
export const folderNameRequestSchema = z.object({ name: folderNameSchema });
/** `PUT /auth/links/:id/folder`; `null` takes the link out of its folder. */
export const moveLinkRequestSchema = z.object({ folderId: z.nullable(z.string()) });

/** Bounds on a link password. The floor only stops an empty or one-key password; strength is the owner's call. */
export const LINK_PASSWORD_MIN = 4;
export const LINK_PASSWORD_MAX = 200;

/** `PUT /auth/links/:id/password`. `null` removes the password and reopens the link. */
export const setLinkPasswordSchema = z.object({
  password: z.nullable(z.string().check(z.minLength(LINK_PASSWORD_MIN), z.maxLength(LINK_PASSWORD_MAX))),
});

/**
 * `PATCH /auth/links/:id`. Omitted fields stay as they are; `ownerExpiresIn: null`
 * clears the owner's expiry. Seconds from now, like the share API's `expires_in`.
 */
export const updateLinkSettingsSchema = z.object({
  access: z.optional(linkAccessSchema),
  ownerExpiresIn: z.optional(z.nullable(z.int().check(z.gte(1), z.lte(MAX_EXPIRES_IN_SECONDS)))),
});
export type UpdateLinkSettings = z.infer<typeof updateLinkSettingsSchema>;
export const updateLinkResponseSchema = z.object({ updated: z.boolean() });

/** Resolves `ownerExpiresIn` against the current value (omitted keeps it, `null`
 * clears it, a number sets `now + n`) — shared so server and dashboard agree. */
export function resolveOwnerExpiresAt({
  ownerExpiresIn,
  current,
  now,
}: {
  ownerExpiresIn: UpdateLinkSettings['ownerExpiresIn'];
  current: number | null;
  now: number;
}): number | null {
  if (ownerExpiresIn === undefined) return current;
  if (ownerExpiresIn === null) return null;
  return now + ownerExpiresIn;
}

export const sessionResponseSchema = z.object({ user: z.nullable(sessionUserSchema) });
export const ownedLinksResponseSchema = z.object({ links: z.array(ownedLinkSchema) });
export const errorResponseSchema = z.object({ error: z.string() });

/**
 * What `POST /auth/request` takes. Only that the field is a string — whether it
 * is an address at all is `normalizeEmail`'s judgement, and deliberately loose.
 */
export const signInRequestSchema = z.object({ email: z.string() });

/**
 * What `POST /auth/links/:id/invite` takes. `url` is the exact link the
 * popover already shows for copying, so `z.url()` only proves it parses —
 * the route still checks it shares the request's own origin before mailing
 * it, since that part depends on runtime request state Zod has no access to.
 */
export const inviteRequestSchema = z.object({ email: z.string(), url: z.url() });

/**
 * When the retention cron will delete a link, or null when nothing is going to.
 *
 * The cron's condition is `(owner_id IS NULL AND last_accessed_at < cutoff) OR
 * expires_at < now OR owner_expires_at < now`, so an explicit expiry brings the
 * date forward — it does not replace the idle window — and a claimed link has no
 * idle window to bring forward. One definition, so a countdown shown to a person
 * can neither outlive its row nor promise a deletion that will not happen.
 * `ownerExpiresAt` and `owned` are optional because a caller holding only the
 * anonymous expiry knows neither.
 */
export function deletionDeadline({
  lastAccessedAt,
  expiresAt,
  ownerExpiresAt = null,
  owned = false,
}: {
  lastAccessedAt: number;
  expiresAt: number | null;
  ownerExpiresAt?: number | null;
  owned?: boolean;
}): number | null {
  const chosen = effectiveExpiresAt({ expiresAt, ownerExpiresAt });
  // Keeping a link is the reason to sign in, so while it has an owner only an
  // expiry someone picked can take it. Releasing it clears `owner_id` and the
  // idle window applies again from `last_accessed_at` — a long-dormant link
  // released today goes on tonight's sweep, which is the intended answer.
  if (owned) return chosen;
  const idleUntil = lastAccessedAt + RETENTION_DAYS * DAY_SECONDS;
  return Math.min(idleUntil, chosen ?? idleUntil);
}
