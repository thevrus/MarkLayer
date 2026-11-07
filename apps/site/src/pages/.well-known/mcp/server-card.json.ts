import { MCP_SERVER_CARD } from '@marklayer/agent-tools';
import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(MCP_SERVER_CARD), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
