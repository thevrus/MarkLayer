import type { APIRoute } from 'astro';
import body from '../../../../content/agent/SKILL.md?raw';

export const GET: APIRoute = () => new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
