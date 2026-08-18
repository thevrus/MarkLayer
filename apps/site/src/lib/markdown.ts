/**
 * Flatten a Markdown intro back to plain prose for hub listings.
 *
 * The detail pages linkify the first mention of a competitor, but the hubs
 * deliberately show unlinked text: a hub is a router, and 12 outbound
 * competitor links on it would compete with the dedicated pages it exists to
 * feed. `[Markup.io](https://markup.io)` → `Markup.io`.
 */
export function plainText(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}
