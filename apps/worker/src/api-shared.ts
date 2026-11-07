import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Env } from './env';
import { type OpenRoom, openRoom, refusalBody } from './lock/gate';

export const ErrorResponse = z.object({ error: z.string() }).openapi('Error');

// A JSON response entry for a route's `responses` map — collapses the repeated
// `{ description, content: { 'application/json': { schema } } }` shape.
export const jsonRes = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * The share API's door: every `/{id}` route reads or changes the room, so each
 * opens it first. `refused` is the response to return as is; `room` carries the
 * stub and whether a row exists yet.
 */
export async function openApiRoom({
  c,
  id,
}: {
  c: Context<Env>;
  id: string;
}): Promise<
  { room: Extract<OpenRoom, { ok: true }>; refused: null } | { room: null; refused: ReturnType<typeof refusalBody> }
> {
  const room = await openRoom({ env: c.env, id, headers: c.req.raw.headers, ctx: c.executionCtx });
  return room.ok ? { room, refused: null } : { room: null, refused: refusalBody(room) };
}

/** Declared on every gated route, so the spec says what a closed link answers. */
export const LOCKED_RESPONSES = {
  401: jsonRes(ErrorResponse, 'Password-protected link: send `Authorization: Bearer <password>`'),
  404: jsonRes(ErrorResponse, 'Not found'),
  410: jsonRes(ErrorResponse, 'Expired'),
  429: jsonRes(ErrorResponse, 'Too many wrong passwords for this link from this client'),
};

export const shareIdParam = (description: string) =>
  z.object({ id: z.string().openapi({ description, example: 'dsWPMrdw6EZ8jkkhxvFKS' }) });

/** Reading: unconstrained, so a room minted before the floor existed still resolves. */
export const IdParam = shareIdParam('Unguessable share id (nanoid/uuid) — it is the access token');
