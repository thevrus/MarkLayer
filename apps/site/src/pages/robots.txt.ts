import type { APIRoute } from 'astro';
import body from '../content/agent/robots.txt?raw';

export const GET: APIRoute = () => new Response(body, { headers: { 'Content-Type': 'text/plain' } });
