import type { APIRoute } from 'astro';
import body from '../content/agent/llms.txt?raw';

export const GET: APIRoute = () => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
