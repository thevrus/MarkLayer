import type { EmailEnv } from './email';
import type { SlackEnv } from './integrations/slack-config';
import type { RoomNamespace } from './room-stub';

/** Just `waitUntil`: Hono's `executionCtx` and a Durable Object's `ctx` both satisfy it, which the full ExecutionContext shape does not. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    /**
     * The room namespace as the routes use it: the narrow interface the real
     * `DurableObjectNamespace<AnnotationRoom>` satisfies, so a test can hand in a fake.
     */
    ANNOTATION_ROOM: RoomNamespace;
    OG_BUCKET: R2Bucket;
    FILE_BUCKET: R2Bucket;
    /** Workers AI, for voice-note transcripts. */
    AI: Ai;
    /** Caps transcription per client IP. Absent in dev and tests, which then run unlimited. */
    TRANSCRIBE_LIMITER?: RateLimit;
    /** Caps anonymous uploads to `POST /f` per client IP. */
    UPLOAD_LIMITER?: RateLimit;
    /** Caps sign-in and invite mail per client IP. */
    EMAIL_LIMITER?: RateLimit;
    /** Caps top-level page fetches and OG renders per client IP. */
    FETCH_LIMITER?: RateLimit;
    /** Caps anonymous share API writes, MCP calls and socket opens per client IP. */
    ROOM_LIMITER?: RateLimit;
    /** Caps relay fallbacks for `/px/*` sub-resources per client IP. */
    RELAY_LIMITER?: RateLimit;
    TURN_KEY_ID?: string;
    TURN_KEY_TOKEN?: string;
    POSTHOG_KEY?: string;
    POSTHOG_HOST?: string;
    /** Public origin for links the worker and its rooms send out; the request's origin when unset. */
    APP_ORIGIN?: string;
    /**
     * The fixed-IP relay (apps/fetcher) the proxy falls back to when a host
     * blocks Cloudflare's shared egress. Both unset — the default — means no
     * fallback, which is how the proxy behaved before the relay existed.
     */
    FETCHER_URL?: string;
    FETCHER_TOKEN?: string;
    /**
     * Off switch. Set to "false" (or "0") to stop using the relay while leaving its URL
     * and token in place — the way to turn the fallback off without deleting
     * config, and the first thing to reach for if the relay host misbehaves.
     */
    FETCHER_ENABLED?: string;
    /**
     * Fallback for the relay's public address, shown to a user whose host blocks
     * even that. Only read when the relay never answered — when it did, it
     * reports its own address on the response, which cannot go stale.
     */
    FETCHER_EGRESS_IP?: string;
    /**
     * Sign-in email, from `EmailEnv` so the bindings the mailer reads are
     * declared once. `EMAIL` is the Cloudflare Email Service send binding and is
     * preferred; `RESEND_API_KEY` is the swap if its unpublished daily quota
     * ever bites. Neither set — the default in dev and in a fork — logs the
     * link instead of sending it, so sign-in still works locally.
     */
    /**
     * The two-way Slack app (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET,
     * SLACK_SIGNING_SECRET, SLACK_TOKEN_KEY). All four or the feature is off;
     * see docs/slack-app.md.
     */
  } & EmailEnv &
    SlackEnv;
};
