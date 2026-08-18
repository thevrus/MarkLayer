import type { APIRoute } from 'astro';
import { API_CATALOG } from '../../lib/agent';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(API_CATALOG), { headers: { 'Content-Type': 'application/linkset+json' } });
