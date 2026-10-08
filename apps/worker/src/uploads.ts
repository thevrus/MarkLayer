/**
 * What an anonymous upload is allowed to be, decided by the bytes themselves.
 *
 * A browser's `Content-Type` on a `POST` body is a claim, not evidence, and the
 * file comes back out of `/f/{id}` on this app's own origin — so the type is
 * settled here, once, and everything downstream reads it back from R2 rather
 * than sniffing again. The formats live in `@marklayer/types` because the file
 * picker offers exactly this list.
 */

import { UPLOAD_FORMATS, type UploadFormat } from '@marklayer/types';

const matches = (bytes: Uint8Array, { offset, bytes: magic }: UploadFormat['magic'][number]): boolean =>
  magic.every((byte, i) => bytes[offset + i] === byte);

/** The content type these bytes actually are, or `undefined` if not one we take. */
export function sniffUploadType(bytes: Uint8Array): string | undefined {
  return UPLOAD_FORMATS.find((format) => format.magic.every((m) => matches(bytes, m)))?.contentType;
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
