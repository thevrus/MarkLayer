/**
 * Frontmatter carries either a bare 11-char YouTube id or a full watch/share/
 * embed URL — this is the one place that has to tell them apart.
 */
export function youtubeVideoId(video: string): string {
  const bareId = /^[\w-]{11}$/;
  if (bareId.test(video)) return video;
  const match = video.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return match?.[1] ?? video;
}
