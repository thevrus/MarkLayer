import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './index';
import { opsArraySchema } from './schema';

const STUN_FALLBACK = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

const api = new Hono<Env>();
api.use('*', cors());

// Generate short-lived TURN credentials for WebRTC
api.get('/turn', async (c) => {
  const keyId = c.env.TURN_KEY_ID;
  const token = c.env.TURN_KEY_TOKEN;
  if (!keyId || !token) return c.json(STUN_FALLBACK);
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
  });
  if (!res.ok) return c.json(STUN_FALLBACK);
  return c.json(await res.json());
});

// Store annotations
api.post('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  // Accept { ops, url?, width?, expires_in? } or a raw ops array for backwards compat
  let ops: unknown;
  let expiresAt: number | null = null;
  let url: string | null = null;
  let width: number | null = null;
  if (Array.isArray(body)) {
    ops = body;
  } else if (body && typeof body === 'object' && 'ops' in body) {
    ops = body.ops;
    if (typeof body.expires_in === 'number' && body.expires_in > 0) {
      expiresAt = Math.floor(Date.now() / 1000) + body.expires_in;
    }
    if (typeof body.url === 'string' && body.url) url = body.url;
    if (typeof body.width === 'number' && body.width > 0) width = body.width;
  } else {
    ops = body;
  }

  const result = opsArraySchema.safeParse(ops);
  if (!result.success) {
    return c.json({ error: 'Invalid operations data' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO annotations (id, ops, url, width, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, url = COALESCE(excluded.url, url), width = COALESCE(excluded.width, width), expires_at = excluded.expires_at`,
  )
    .bind(id, JSON.stringify(result.data), url, width, expiresAt)
    .run();

  return c.json({ ok: true });
});

// Retrieve annotations
api.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT ops, url, width, expires_at FROM annotations WHERE id = ?')
    .bind(id)
    .first<{ ops: string; url: string | null; width: number | null; expires_at: number | null }>();

  if (!row) return c.json({ error: 'not found' }, 404);

  // Check expiration
  if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM annotations WHERE id = ?').bind(id).run());
    return c.json({ error: 'expired' }, 410);
  }

  // Touch last_accessed_at (fire-and-forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  return c.json({ ops: JSON.parse(row.ops), url: row.url, width: row.width });
});

// ---------- Projects (multi-page bundles) ----------

const MAX_PAGES_PER_PROJECT = 50;

// Upsert a project (page id list)
api.post('/p/:id', async (c) => {
  const id = c.req.param('id');
  const body: unknown = await c.req.json().catch(() => null);
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
  const rawPages = isRecord(body) ? body.pageIds : undefined;
  if (!Array.isArray(rawPages)) return c.json({ error: 'pageIds required' }, 400);
  const pageIds = rawPages.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (!pageIds.length) return c.json({ error: 'pageIds must contain at least one id' }, 400);
  if (pageIds.length > MAX_PAGES_PER_PROJECT) {
    return c.json({ error: `Project exceeds ${MAX_PAGES_PER_PROJECT} pages` }, 400);
  }
  let expiresAt: number | null = null;
  const expiresIn = isRecord(body) ? body.expires_in : undefined;
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  }
  await c.env.DB.prepare(
    `INSERT INTO projects (id, page_ids, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET page_ids = excluded.page_ids, expires_at = excluded.expires_at, last_accessed_at = unixepoch()`,
  )
    .bind(id, JSON.stringify(pageIds), expiresAt)
    .run();
  return c.json({ ok: true });
});

// Fetch a project + all of its pages (eager join)
api.get('/p/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT page_ids, created_at, expires_at FROM projects WHERE id = ?')
    .bind(id)
    .first<{ page_ids: string; created_at: number | null; expires_at: number | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run());
    return c.json({ error: 'expired' }, 410);
  }
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE projects SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  let pageIds: string[] = [];
  try {
    const parsed = JSON.parse(row.page_ids);
    if (Array.isArray(parsed)) pageIds = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* corrupt row → empty list */
  }
  if (!pageIds.length) {
    return c.json({ pageIds: [], pages: [], createdAt: row.created_at, expiresAt: row.expires_at });
  }
  const placeholders = pageIds.map(() => '?').join(',');
  const pageRows = await c.env.DB.prepare(`SELECT id, ops, url, width FROM annotations WHERE id IN (${placeholders})`)
    .bind(...pageIds)
    .all<{ id: string; ops: string; url: string | null; width: number | null }>();
  const byId = new Map<string, { id: string; ops: unknown[]; url: string | null; width: number | null }>();
  for (const r of pageRows.results) {
    let parsedOps: unknown[] = [];
    try {
      const v = JSON.parse(r.ops);
      if (Array.isArray(v)) parsedOps = v;
    } catch {
      /* */
    }
    byId.set(r.id, { id: r.id, ops: parsedOps, url: r.url, width: r.width });
  }
  // Preserve original order; missing rows become empty placeholders
  const pages = pageIds.map((pid) => byId.get(pid) ?? { id: pid, ops: [], url: null, width: null });
  return c.json({ pageIds, pages, createdAt: row.created_at, expiresAt: row.expires_at });
});

export { api };
