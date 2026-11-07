/**
 * What an anonymous upload is allowed to be, decided by the bytes themselves.
 *
 * A browser's `Content-Type` on a `POST` body is a claim, not evidence, and the
 * file comes back out of `/f/{id}` on this app's own origin — so the type is
 * settled here, once, and everything downstream reads it back from R2 rather
 * than sniffing again. The formats live in `@marklayer/types` because the file
 * picker offers exactly this list.
 */

import {
  isAudioType,
  isVideoType,
  MAX_VIDEO_BYTES,
  MAX_VOICE_BYTES,
  UPLOAD_FORMATS,
  type UploadFormat,
} from '@marklayer/types/uploads';

const matches = (bytes: Uint8Array, { offset, bytes: magic }: UploadFormat['magic'][number]): boolean =>
  magic.every((byte, i) => bytes[offset + i] === byte);

const sniffAmong = (formats: UploadFormat[], bytes: Uint8Array): string | undefined =>
  formats.find((format) => format.magic.every((m) => matches(bytes, m)))?.contentType;

// Video shares its magic with audio, so a plain upload never sniffs as video.
const NON_VIDEO_FORMATS = UPLOAD_FORMATS.filter((format) => !isVideoType(format.contentType));
const VIDEO_FORMATS = UPLOAD_FORMATS.filter((format) => isVideoType(format.contentType));

/** `POST /f`'s verdict on a body: the type to store it as, or the status to refuse it with. */
export type UploadVerdict = { contentType: string } | { status: 413 | 415; message: string };

/** `kind=video` is the caller's word that a WebM/MP4 is a camera or screen clip rather than a voice note. */
export function classifyUpload({ bytes, kind }: { bytes: Uint8Array; kind?: string }): UploadVerdict {
  if (kind === 'video') {
    const contentType = sniffAmong(VIDEO_FORMATS, bytes);
    if (!contentType) return { status: 415, message: 'Not a video recording' };
    if (bytes.byteLength > MAX_VIDEO_BYTES) return { status: 413, message: 'Video note too large' };
    return { contentType };
  }
  const contentType = sniffAmong(NON_VIDEO_FORMATS, bytes);
  if (!contentType) return { status: 415, message: 'Unsupported file type' };
  // A recording is at most MAX_VOICE_SECONDS long, and every one is fed to a paid model.
  if (isAudioType(contentType) && bytes.byteLength > MAX_VOICE_BYTES) {
    return { status: 413, message: 'Voice note too large' };
  }
  return { contentType };
}

/** A refusal, or which bytes go to the model: the stored upload's own, or the request body's. */
export type TranscriptionSource = 'stored' | 'body' | { status: 413 | 415; message: string };

/**
 * What `POST /f/:id/transcribe` feeds the paid model: a voice note's own bytes, or for a video
 * the audio track the client recorded beside it, since a Worker cannot demux the clip. That
 * track is held to a voice note's limits, so a video id buys no bigger transcription.
 */
export function transcriptionSource({
  stored,
  body,
}: {
  stored: string | undefined;
  body: Uint8Array;
}): TranscriptionSource {
  if (!isUploadType(stored)) return { status: 415, message: 'Not a recording' };
  if (isAudioType(stored)) return 'stored';
  if (!isVideoType(stored)) return { status: 415, message: 'Not a recording' };
  if (body.byteLength > MAX_VOICE_BYTES) return { status: 413, message: 'Audio track too large' };
  const sniffed = sniffAmong(NON_VIDEO_FORMATS, body);
  if (!sniffed || !isAudioType(sniffed)) return { status: 415, message: "Send the clip's audio track" };
  return 'body';
}

/**
 * A request body, counted as it arrives: `Content-Length` is only a claim, so the cap holds
 * against the bytes received and stops pulling once blown. Null means over the cap.
 */
export async function readCapped({
  stream,
  cap,
}: {
  stream: ReadableStream<Uint8Array> | null;
  cap: number;
}): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Read a stored type back, rather than trusting it. R2 metadata is written by
 * this Worker alone, but a type is a header the browser acts on, so it is
 * checked against the same list on the way out.
 */
export function isUploadType(contentType: string | undefined): contentType is string {
  return UPLOAD_FORMATS.some((format) => format.contentType === contentType);
}

/** For the download filename. Anything unrecognised never reaches here. */
export function extensionFor(contentType: string): string {
  return UPLOAD_FORMATS.find((format) => format.contentType === contentType)?.extension ?? 'bin';
}

/**
 * The byte span a `Range` header asks for, clamped to the object. Undefined when it cannot be
 * served (past the end, malformed, or several ranges): the caller answers 416 instead of letting
 * R2 throw on it.
 */
export function resolveRange({ header, size }: { header: string; size: number }): ByteSpan | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size === 0) return undefined;
  const [, first = '', last = ''] = match;
  if (first === '') {
    const suffix = Number(last);
    if (!suffix) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return undefined;
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return undefined;
  return { start, end };
}

export type ByteSpan = { start: number; end: number };
