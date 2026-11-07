import { z } from 'zod/mini';
import { FIREWALL_IDS } from './proxy-errors';

/**
 * What crosses between a proxied page and the app that frames it. The proxy's injected
 * scripts interpolate these names and the viewer, Compare and DeviceOverview parse through
 * this module, so neither side holds its own copy of a string.
 */
export const FRAME_MESSAGE = {
  navigate: 'ml-navigate',
  blocked: 'ml-blocked',
  errors: 'ml-errors',
  scroll: 'ml-scroll',
  ready: 'ml-ready',
  key: 'ml-key',
} as const;

export const PARENT_MESSAGE = { scrollSync: 'ml-scroll-sync', scrollTo: 'ml-scroll-to' } as const;

/** `document.documentElement.dataset[MARKLAYER_MARKER]`, stamped into the HTML, so present before paint. */
export const MARKLAYER_MARKER = 'marklayer';
export const MARKLAYER_MARKER_VALUE = '1';

export const hasFrameMarker = (
  doc: { documentElement?: { dataset: Record<string, string | undefined> } | null } | null | undefined,
): boolean => doc?.documentElement?.dataset[MARKLAYER_MARKER] === MARKLAYER_MARKER_VALUE;

/** doc.html's stamp: a PDF or an image, with no element tree to inspect and no responsive layout to resize. */
export const isDocumentFrame = (
  doc: { documentElement?: { dataset: Record<string, string | undefined> } | null } | null | undefined,
): boolean => doc?.documentElement?.dataset.doc === '1';

export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms';
/** DeviceOverview's previews are looked at, never submitted to or opened from. */
export const FRAME_SANDBOX_PREVIEW = 'allow-scripts allow-same-origin';

const keySchema = z.object({
  type: z.literal(FRAME_MESSAGE.key),
  phase: z.enum(['keydown', 'keyup']),
  key: z.string(),
  code: z.string(),
  metaKey: z.boolean(),
  ctrlKey: z.boolean(),
  shiftKey: z.boolean(),
  altKey: z.boolean(),
  /** The key was aimed at a field in the page, so host shortcuts stay quiet. */
  editable: z.boolean(),
});

export const frameMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(FRAME_MESSAGE.navigate), url: z.string() }),
  z.object({
    type: z.literal(FRAME_MESSAGE.blocked),
    reason: z.enum(['firewall', 'http']),
    status: z.number(),
    via: z.enum(['direct', 'relay']),
    ip: z.nullable(z.string()),
    firewall: z.nullable(z.enum(FIREWALL_IDS)),
  }),
  // Items stay unknown: `ingestPageErrors` validates each one, since the page controls them.
  z.object({ type: z.literal(FRAME_MESSAGE.errors), errors: z.array(z.unknown()) }),
  z.object({ type: z.literal(FRAME_MESSAGE.scroll), ratio: z.number() }),
  z.object({ type: z.literal(FRAME_MESSAGE.ready) }),
  keySchema,
]);

export type FrameMessage = z.infer<typeof frameMessageSchema>;

export type ParentMessage =
  | { type: typeof PARENT_MESSAGE.scrollSync; on: boolean }
  | { type: typeof PARENT_MESSAGE.scrollTo; ratio: number };

interface FrameLike {
  readonly contentWindow: object | null;
}

/**
 * The one listener for frame messages. Anything that is not from one of `frames`, or does
 * not parse, never reaches `handler`. `frames` is read per event because refs change.
 */
export function onFrameMessage<F extends FrameLike>({
  frames,
  handler,
  host = window,
}: {
  frames: () => ReadonlyArray<F | null | undefined>;
  handler: (delivery: { message: FrameMessage; frame: F }) => void;
  host?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}): () => void {
  const listener = (e: Event) => {
    if (!(e instanceof MessageEvent) || !e.source) return;
    const frame = frames().find((candidate) => candidate?.contentWindow === e.source);
    if (!frame) return;
    const parsed = frameMessageSchema.safeParse(e.data);
    if (parsed.success) handler({ message: parsed.data, frame });
  };
  host.addEventListener('message', listener);
  return () => host.removeEventListener('message', listener);
}
