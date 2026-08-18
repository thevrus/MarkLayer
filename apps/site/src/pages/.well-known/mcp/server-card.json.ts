import type { APIRoute } from 'astro';
import { MCP_SERVER_CARD } from '../../../lib/agent';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(MCP_SERVER_CARD), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
