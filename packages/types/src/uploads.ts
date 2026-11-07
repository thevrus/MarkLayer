import { z } from 'zod/mini';

/** The cap on an anonymous upload. Enforced server-side; shown client-side. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The longest voice note a comment records. Also the cap the recorder stops itself at. */
export const MAX_VOICE_SECONDS = 120;

/** Cap on a voice-note upload: 120 s of Opus/AAC is well under 1 MB, so 4 MB leaves ample headroom while keeping the model call cheap. */
export const MAX_VOICE_BYTES = 4 * 1024 * 1024;

/** The longest video note a comment records; the recorder stops itself here too. */
export const MAX_VIDEO_SECONDS = 120;

/** Cap on a video-note upload: 120 s at the recorder's ~1 Mbit/s is ~15 MB. Stays under MAX_UPLOAD_BYTES. */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** A format the product accepts as an upload: what it is, and how to recognise it. */
export const uploadFormatSchema = z.object({
  contentType: z.string(),
  /** For the download filename. */
  extension: z.string(),
  /** Byte sequences that must all match, keyed by the offset they sit at. */
  magic: z.array(z.object({ offset: z.number(), bytes: z.array(z.number()) })),
});

export type UploadFormat = z.infer<typeof uploadFormatSchema>;

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/**
 * Raster images and PDFs, and the bytes that prove it.
 *
 * One table because the file picker's `accept` and the server's sniffer are the
 * same question asked twice, and a disagreement means a person is offered a file
 * that is then rejected. Deliberately no SVG: it is a document that can carry
 * script, and served back from `/f/{id}` that script would run with this
 * origin's cookies and storage. It also has no magic number to check.
 */
export const UPLOAD_FORMATS: UploadFormat[] = [
  { contentType: 'application/pdf', extension: 'pdf', magic: [{ offset: 0, bytes: ascii('%PDF-') }] },
  {
    contentType: 'image/png',
    extension: 'png',
    magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  { contentType: 'image/jpeg', extension: 'jpg', magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { contentType: 'image/gif', extension: 'gif', magic: [{ offset: 0, bytes: ascii('GIF8') }] },
  // Both are ISO-BMFF-ish containers: a chunk/box tag at 4 and the flavour at 8,
  // with the length field in between meaning byte 0 alone identifies neither.
  {
    contentType: 'image/webp',
    extension: 'webp',
    magic: [
      { offset: 0, bytes: ascii('RIFF') },
      { offset: 8, bytes: ascii('WEBP') },
    ],
  },
  {
    contentType: 'image/avif',
    extension: 'avif',
    magic: [
      { offset: 4, bytes: ascii('ftyp') },
      { offset: 8, bytes: ascii('avi') },
    ],
  },
  // Voice notes, from the comment composer's recorder. The containers are shared
  // with video (WebM, Ogg and MP4 all carry either), which is harmless here: the
  // bytes are only ever served back as a media type with `nosniff`, which cannot
  // run script. MP4 is matched by brand because the flavour at 8 is all that
  // tells it from an AVIF; Safari's recorder writes one of these, never `avif`.
  { contentType: 'audio/webm', extension: 'webm', magic: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] },
  { contentType: 'audio/ogg', extension: 'ogg', magic: [{ offset: 0, bytes: ascii('OggS') }] },
  ...['M4A ', 'mp42', 'iso5', 'isom'].map((brand) => ({
    contentType: 'audio/mp4',
    extension: 'm4a',
    magic: [
      { offset: 4, bytes: ascii('ftyp') },
      { offset: 8, bytes: ascii(brand) },
    ],
  })),
  // Video notes: the same containers as above, so bytes alone cannot choose these.
  // Only an upload that says `kind=video` is sniffed against them (`isVideoType`).
  // Any `ftyp` brand passes: no other format competes on that path, and an unlisted
  // brand from one browser's recorder would otherwise fail as a 415.
  { contentType: 'video/webm', extension: 'webm', magic: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] },
  { contentType: 'video/mp4', extension: 'mp4', magic: [{ offset: 4, bytes: ascii('ftyp') }] },
];

/** Recordings come from the composer's mic button, so no file picker or drop zone should offer them. */
export const isAudioType = (contentType: string): boolean => contentType.startsWith('audio/');

/** Video notes come from the composer's camera/screen recorder, never a picker, like audio. */
export const isVideoType = (contentType: string): boolean => contentType.startsWith('video/');

/** What a picker, drop zone or paste accepts, derived so it cannot drift from what the sniffer takes. */
export const PICKABLE_TYPES = UPLOAD_FORMATS.map((format) => format.contentType).filter(
  (type) => !isAudioType(type) && !isVideoType(type),
);

/** The same list narrowed to images, for the pickers that take screenshots rather than documents. */
export const UPLOAD_IMAGE_ACCEPT = UPLOAD_FORMATS.filter((format) => format.contentType.startsWith('image/'))
  .map((format) => format.contentType)
  .join(',');

/** What `POST /f` answers with, parsed by the caller rather than read field by field. */
export const uploadResponseSchema = z.object({ id: z.string(), url: z.string() });

/** What `POST /f/:id/transcribe` answers with (for a video, the call's body is the clip's separately recorded audio track); `text` is empty when the note held no speech. A model failure is a 503, not an empty text. */
export const transcribeResponseSchema = z.object({ text: z.string() });
