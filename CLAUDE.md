# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MarkLayer — free annotation/collaboration tool for any webpage. Monorepo with a Chrome extension, a Cloudflare Worker backend + web app, and an MCP server that bridges annotations to AI coding agents.

## Tech Stack

- **UI:** Preact + Preact Signals, Tailwind CSS v4, Lucide icons
- **Extension:** WXT framework
- **Backend:** Cloudflare Workers, Hono, D1 (SQLite), Durable Objects (WebSocket), R2
- **Validation:** Zod (shared client/server)
- **Build:** Bun workspaces, Turborepo, Vite
- **Lint/Format:** Biome (sole tool — no ESLint/Prettier)

## Commands

```bash
bun install          # First-time setup (runs wxt prepare for extension)
bun run dev          # All apps dev mode (Turbo)
bun run build        # Build all
bun run check        # TypeScript check all (per-workspace `tsc --noEmit`)
bun run lint         # Biome lint + format check
bun run lint:fix     # Biome auto-fix
bun run deploy       # Build all + deploy worker to Cloudflare

# Extension only
cd apps/extension && bun dev               # Chrome (MV3) dev
cd apps/extension && bun dev:firefox       # Firefox dev
cd apps/extension && bun build             # Chrome build
cd apps/extension && bun build:firefox     # Firefox build
cd apps/extension && bun zip               # Package zip for store upload

# Worker only
cd apps/worker && bun dev          # Vite + Wrangler together
cd apps/worker && bun run deploy   # Build + `wrangler deploy`

# MCP server only (published to npm as `marklayer-mcp`)
cd apps/mcp && bun run build       # Compile TS → dist/cli.js
cd apps/mcp && bun run dev         # tsc --watch
```

No test framework is configured — relying on `bun run check` (TypeScript) and `bun run lint` (Biome) is the verification loop.

## Structure

```
apps/extension/     # Chrome/Firefox extension (WXT + Preact)
  components/       # Canvas, Toolbar, all annotation Layer components
  lib/              # state.ts (signals), renderer.ts, selector.ts, anchor.ts
apps/worker/        # CF Worker API + web app (Hono + Vite + Preact)
  src/              # index.ts (Hono routes), annotation-room.ts (Durable Object),
                    # proxy.ts (iframe proxy + SSRF guard), og.ts (Satori OG cards),
                    # pages.tsx (SSR), seo.ts
  web/              # Web app UI (Landing, Viewer, Web* layer components,
                    # useRealtimeSync, useVoiceRoom, signals)
  schema.sql        # D1 database schema
  wrangler.jsonc    # Worker bindings (D1, DO, R2)
apps/mcp/           # MCP server (`marklayer-mcp` on npm) — exposes annotation
                    # rooms as tools (watch/acknowledge/resolve/reply) for AI agents
packages/types/     # Shared types & Zod schemas (DrawOp union, CommentOp, Peer,
                    # AnchorPoint, target element metadata). Single source of truth
                    # for client + server validation.
```

## Conventions

- **Preact, not React** — use `preact/hooks`, `@preact/signals`. Vite aliases `react` and `react-dom` to `preact/compat` (worker) and WXT's preact preset handles the extension.
- **Single quotes, always semicolons** — enforced by Biome (line width 120, 2-space indent).
- **No `any`** — `noExplicitAny: error` in Biome.
- **Avoid `as` casts** and **prefer signals over `useEffect`** (see auto-memory) — fix upstream types, use Zod parsing or guards; derive with `useSignalEffect` / computed signals.
- **Cloudflare only** for infra — D1, Durable Objects, R2, Workers.
- Worker imports extension components via `@ext/*` path alias (`apps/worker → apps/extension`).
- State management uses Preact Signals (not `useState` for shared state). Extension state lives in `apps/extension/lib/state.ts`; web state in `apps/worker/web/signals.ts`.
- Zod schemas in `packages/types` are the source of truth — derive TS types via `z.infer`, parse all wire data.
- IDs generated with `nanoid`.

## Architecture Notes

- **Real-time sync**: clients connect via WebSocket to a per-room Durable Object (`AnnotationRoom` in `apps/worker/src/annotation-room.ts`). Ops broadcast to peers and persist to D1.
- **Voice/video**: peer-to-peer WebRTC negotiated through the same DO (`apps/worker/web/useVoiceRoom.ts`); TURN fallback configured.
- **Iframe proxy**: the worker fetches the target URL and strips frame-blocking headers (`X-Frame-Options`, CSP) so it can be embedded. SSRF guard blocks private/loopback hosts.
- **Canvas overlay**: a transparent Preact root is injected over the iframe (extension) or the proxied page (web). Each tool is a sibling Layer component (`Canvas`, `CommentLayer`, `AreaLayer`, `InspectorLayer`, `MeasureLayer`, `MultiInspectLayer`, `SelectionLayer`, `TextLayer`); web versions live in `apps/worker/web/Web*.tsx`.
- **Anchoring**: annotations bind to host-page elements via `lib/anchor.ts` + `lib/selector.ts` (CSS selector + text-fingerprint fallback for SPAs). Selectors re-resolve on host-page mutations via a MutationObserver tick signal; DPR-aware scale capture preserves layout across viewport changes.
- **OG cards**: generated server-side with Satori + `@resvg/resvg-wasm`, cached in R2. Disabled for localhost / private hosts.
- **MCP integration**: `apps/mcp` exposes annotation rooms as MCP tools (`marklayer_watch_annotations`, `acknowledge`, `resolve`, `reply`, …) so an agent can poll a room and act on comments while the human sees live status.
- **Cleanup**: daily cron (3 AM UTC, configured in `wrangler.jsonc`) deletes annotations past their 30-day TTL.
