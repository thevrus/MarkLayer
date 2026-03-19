# CLAUDE.md

## Project

MarkLayer — free annotation/collaboration tool for any webpage. Monorepo with a Chrome extension and Cloudflare Worker backend + web app.

## Tech Stack

- **UI:** Preact + Preact Signals, Tailwind CSS v4, Lucide icons
- **Extension:** WXT framework
- **Backend:** Cloudflare Workers, Hono, D1 (SQLite), Durable Objects (WebSocket), R2
- **Validation:** Zod (shared client/server)
- **Build:** Bun workspaces, Turborepo, Vite
- **Lint/Format:** Biome (sole tool — no ESLint/Prettier)

## Commands

```bash
bun run dev          # All apps dev mode (Turbo)
bun run build        # Build all
bun run check        # TypeScript check all
bun run lint         # Biome lint
bun run lint:fix     # Biome auto-fix

# Extension only
cd apps/extension && bun dev
cd apps/extension && bun build

# Worker only
cd apps/worker && bun dev          # Vite + Wrangler together
cd apps/worker && bun dev:web      # Vite only
cd apps/worker && bun dev:worker   # Wrangler only
cd apps/worker && bun deploy       # Build + deploy to CF
```

## Structure

```
apps/extension/     # Chrome extension (WXT + Preact)
apps/worker/        # CF Worker API + web app (Hono + Vite + Preact)
  src/              # Worker code (routes, Durable Object, schemas)
  web/              # Web app UI components
  schema.sql        # D1 database schema
packages/types/     # Shared TypeScript types (DrawOp, CommentOp, Peer, etc.)
```

## Conventions

- **Preact, not React** — use `preact/hooks`, `@preact/signals`. Vite aliases React to Preact.
- **Single quotes, always semicolons** — enforced by Biome (line width 120).
- **No `any`** — `noExplicitAny: error` in Biome.
- **Cloudflare only** for infra — D1, Durable Objects, R2, Workers.
- **No tests** — no test framework configured; rely on type checking and Biome.
- Worker imports extension components via `@ext/*` path alias.
- State management uses Preact Signals (not useState for shared state).
- IDs generated with `nanoid`.

## Architecture Notes

- Real-time sync via WebSocket → Durable Object (`AnnotationRoom`)
- Worker proxies target URLs in iframe, stripping frame-blocking headers
- Canvas overlay (transparent Preact component) sits on top of iframe
- OG images generated server-side with Satori + ResvgWasm
- SSRF protection on proxy endpoint (blocked hosts list)
- Daily cron (3 AM) cleans expired annotations
