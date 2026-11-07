import { isUploadId, uploadPath } from '@marklayer/brand/links';
import { isVideoType, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, MAX_VOICE_BYTES } from '@marklayer/types/uploads';
import { cors } from 'hono/cors';
import { Hono } from 'hono/tiny';
import { nanoid } from 'nanoid';
import { toBase64 } from './encoding';
import type { Env } from './env';
import { overRateLimit } from './rate-limit';
import { uploadStore } from './store';
import {
  type ByteSpan,
  classifyUpload,
  extensionFor,
  isUploadType,
  readCapped,
  resolveRange,
  transcriptionSource,
} from './uploads';

const app = new Hono<Env>();

// Wildcard and credential-less, like `/api`: the id is the token, and an embedded widget uploads cross-origin.
// `/f/:id` leaves out `/transcribe`, which feeds a paid model.
app.use('/f', cors());
app.use('/f/:id', cors());

// Anonymous file upload, so a share can annotate a local PDF or image and not
// just a public URL. The id itself is the access token, same as an annotation's.
app.post('/f', async (c) => {
  if (await overRateLimit({ limiter: c.env.UPLOAD_LIMITER, req: c.req })) return c.text('Too many requests', 429);
  if (!c.req.raw.body) return c.text('Empty body', 400);
  const kind = c.req.query('kind');
  const body = await readCapped({ stream: c.req.raw.body, cap: kind === 'video' ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES });
  if (!body) return c.text('File too large', 413);
  const size = body.byteLength;

  // Sniff the real bytes, never the client's declared Content-Type: this type is
  // what `/f/{id}` will later hand a browser on our own origin.
  const verdict = classifyUpload({ bytes: body, kind });
  if ('status' in verdict) return c.text(verdict.message, verdict.status);
  const { contentType } = verdict;

  const id = nanoid();
  // Row first: the cleanup cron sweeps R2 by what it finds in D1, so an object
  // written without one would never be collected. The reverse order only risks a
  // row pointing at nothing, which reads as a 404 and expires on its own.
  await uploadStore(c.env.DB).put({ id, size });
  await c.env.FILE_BUCKET.put(id, body, { httpMetadata: { contentType } });
  return c.json({ id, url: uploadPath(id) });
});

app.get('/f/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUploadId(id)) return c.notFound();

  // Safari will not play an `<audio>` from a server that cannot answer a range
  // request, so a Range header is honoured for every stored type.
  const rangeHeader = c.req.header('Range');
  let span: ByteSpan | undefined;
  if (rangeHeader !== undefined) {
    const head = await c.env.FILE_BUCKET.head(id);
    if (!head) return c.notFound();
    // R2 throws on a range it cannot satisfy; answer it as the protocol says instead of a 500.
    span = resolveRange({ header: rangeHeader, size: head.size });
    if (!span) return c.body(null, 416, { 'Content-Range': `bytes */${head.size}` });
  }
  const object = await c.env.FILE_BUCKET.get(
    id,
    span ? { range: { offset: span.start, length: span.end - span.start + 1 } } : undefined,
  );
  if (!object) return c.notFound();

  // Written by the upload route, but re-checked rather than echoed: this value
  // becomes a `Content-Type` the browser acts on.
  const stored = object.httpMetadata?.contentType;
  if (!isUploadType(stored)) return c.notFound();

  // Push the retention clock back without delaying the response. Once per read, not
  // once per range: an `<audio>` seeking issues a request for every jump.
  if (!span || span.start === 0) c.executionCtx.waitUntil(uploadStore(c.env.DB).touch(id));

  return new Response(object.body, {
    status: span ? 206 : 200,
    headers: {
      'Content-Type': stored,
      // Load-bearing: without this, a sniffing browser could treat the bytes at
      // this URL as something other than what they were stored as and execute
      // them as the app's own origin.
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="document.${extensionFor(stored)}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      ...(span && {
        'Content-Range': `bytes ${span.start}-${span.end}/${object.size}`,
        'Content-Length': String(span.end - span.start + 1),
      }),
    },
  });
});

// Transcribes one stored voice or video note. Its own route rather than part of `POST /f`:
// the upload stays a plain, fast store that a model outage cannot fail, and the
// client decides whether to wait on text. The id is the access token, as for `GET`.
app.post('/f/:id/transcribe', async (c) => {
  const id = c.req.param('id');
  if (!isUploadId(id)) return c.notFound();

  // A transcript is stored on first success, so a repeat call never reruns the model.
  const uploads = uploadStore(c.env.DB);
  const cached = await uploads.transcript(id);
  if (cached !== null) return c.json({ text: cached });

  if (await overRateLimit({ limiter: c.env.TRANSCRIBE_LIMITER, req: c.req })) return c.text('Too many requests', 429);

  // `head`, not `get`: a video's own bytes are never read, only the audio track sent with the call.
  const head = await c.env.FILE_BUCKET.head(id);
  if (!head) return c.notFound();
  const stored = head.httpMetadata?.contentType;
  const body =
    stored && isVideoType(stored)
      ? await readCapped({ stream: c.req.raw.body, cap: MAX_VOICE_BYTES })
      : new Uint8Array(0);
  if (!body) return c.text('Audio track too large', 413);
  const source = transcriptionSource({ stored, body });
  if (typeof source === 'object') return c.text(source.message, source.status);
  const audio = source === 'body' ? body : await (await c.env.FILE_BUCKET.get(id))?.arrayBuffer();
  if (!audio) return c.notFound();

  try {
    const { text } = await c.env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: toBase64(new Uint8Array(audio)),
    });
    const transcript = text.trim();
    await uploads.setTranscript({ id, text: transcript });
    return c.json({ text: transcript });
  } catch (err) {
    // Distinct from an empty transcript so the client can say so; the audio is already stored.
    console.error('transcription failed', err);
    return c.text('Transcription unavailable', 503);
  }
});

export { app as uploadRoutes };
