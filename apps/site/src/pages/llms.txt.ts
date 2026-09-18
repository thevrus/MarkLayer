import type { APIRoute } from 'astro';
import body from '../content/agent/llms.txt?raw';
import { getCurrentVersion } from '../lib/collections';

/**
 * The version is substituted at build time rather than written into the text.
 * It was hardcoded, and it sat at 0.5.0 through three releases telling every
 * agent that read it the wrong number — the same drift the home page's schema
 * avoids by deriving `softwareVersion` from this collection.
 */
export const GET: APIRoute = async () =>
  new Response(body.replaceAll('{{version}}', await getCurrentVersion()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
