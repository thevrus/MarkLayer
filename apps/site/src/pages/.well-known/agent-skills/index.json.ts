import { createHash } from 'node:crypto';
import type { APIRoute } from 'astro';
import skill from '../../../content/agent/SKILL.md?raw';
import { skillIndex } from '../../../lib/agent';

const INDEX = skillIndex(`sha256:${createHash('sha256').update(skill).digest('hex')}`);

export const GET: APIRoute = () =>
  new Response(JSON.stringify(INDEX), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
