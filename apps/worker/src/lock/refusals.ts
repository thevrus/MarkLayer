import { ROOM_EXPIRED_CLOSE_CODE, ROOM_LOCKED_CLOSE_CODE } from '@marklayer/types/wire';
import { FAILURE_WINDOW_MINUTES } from './failures';

/** Why a room's door stayed shut. The gate decides; every renderer reads the one table below. */
export type RoomRefusal = 'gone' | 'expired' | 'locked' | 'wrong' | 'throttled';

/**
 * The one refusal table. `error` is the JSON body and the socket close reason;
 * `prompt` is what the unlock page says above its form (null: no form, a plain page).
 */
export const REFUSALS = {
  gone: {
    status: 404,
    close: ROOM_EXPIRED_CLOSE_CODE,
    error: 'not found',
    title: 'This link is gone',
    prompt: null,
  },
  expired: {
    status: 410,
    close: ROOM_EXPIRED_CLOSE_CODE,
    error: 'expired',
    title: 'This link has expired',
    prompt: null,
  },
  locked: {
    status: 401,
    close: ROOM_LOCKED_CLOSE_CODE,
    error: 'This link is password protected. Send the password as `Authorization: Bearer <password>`.',
    title: 'This link is password protected',
    prompt: '',
  },
  wrong: {
    status: 401,
    close: ROOM_LOCKED_CLOSE_CODE,
    error: 'Wrong password for this link.',
    title: 'This link is password protected',
    prompt: 'That password is not right. Check it with whoever sent you the link.',
  },
  throttled: {
    status: 429,
    close: ROOM_LOCKED_CLOSE_CODE,
    error: `Too many wrong passwords. Try again in ${FAILURE_WINDOW_MINUTES} minutes.`,
    title: 'This link is password protected',
    prompt: `Too many wrong passwords. Wait ${FAILURE_WINDOW_MINUTES} minutes, then try again.`,
  },
} as const satisfies Record<
  RoomRefusal,
  { status: 401 | 404 | 410 | 429; close: number; error: string; title: string; prompt: string | null }
>;

/** The reasons that end in a password prompt rather than a dead end. */
export type LockRefusal = 'locked' | 'wrong' | 'throttled';
export const asksForPassword = (reason: RoomRefusal): reason is LockRefusal => REFUSALS[reason].prompt !== null;
