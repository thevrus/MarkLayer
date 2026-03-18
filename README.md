# MarkLayer

Annotate any webpage, together. Draw, highlight, comment, and collaborate in real-time — no sign-up required.

**[Try it live](https://marklayer.app)**

---

## What is this?

MarkLayer lets you annotate any public webpage. Paste a URL, draw on top of it, leave comments, and share the result as a link. Others can join the same session and see changes in real-time.

It works as a **web app** (zero install) or as a **Chrome extension** for annotating pages natively.

### Features

- **Drawing tools** — pen, highlighter, shapes, arrows, text
- **Threaded comments** — pin comments anywhere on the page, reply inline
- **Real-time collaboration** — cursors, drawings, and comments sync live via WebSocket
- **Shareable links** — one link to share your annotated page with anyone
- **No account needed** — just paste a URL and start
- **Export to PNG** — save your annotations as an image
- **Privacy-first** — annotations auto-expire after 30 days of inactivity

## Architecture

```
marklayer/
├── apps/
│   ├── extension/     # Chrome extension (WXT + Preact)
│   └── worker/        # Cloudflare Worker (Hono + Preact SSR)
│       ├── src/       # API routes, WebSocket rooms, proxy
│       └── web/       # Landing page + annotation viewer
├── packages/
│   └── types/         # Shared TypeScript types
```

| Component | Stack |
|-----------|-------|
| **Web app** | Preact + Signals, Tailwind CSS v4, Vite |
| **Extension** | WXT, Preact, Chrome APIs |
| **Backend** | Cloudflare Workers, Hono, Durable Objects |
| **Database** | Cloudflare D1 (SQLite) |
| **Real-time** | WebSocket via Durable Objects |

## Getting started

```bash
# Install dependencies
bun install

# Run the web app locally
cd apps/worker
bun dev

# Run the extension in dev mode
cd apps/extension
bun dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all apps in dev mode (via Turborepo) |
| `bun run build` | Build all apps |
| `bun run format` | Format the entire codebase (Biome) |
| `bun run lint` | Lint the entire codebase (Biome) |
| `bun run lint:fix` | Auto-fix lint issues |

### Deploying

The web app deploys to Cloudflare Workers:

```bash
cd apps/worker
bun run deploy    # vite build && wrangler deploy
```

You'll need a Cloudflare account with D1 and Durable Objects enabled. See `apps/worker/wrangler.jsonc` for the configuration.

## How it works

1. User pastes a URL on the landing page
2. The worker proxies the target page (stripping frame-blocking headers) and renders it in an iframe
3. A transparent canvas overlay sits on top for drawing
4. All operations (strokes, shapes, comments) sync through a Durable Object room via WebSocket
5. Operations persist to D1 and auto-expire after 30 days without access

## Author

**Vadym Rusin** — [@rusinvadym](https://github.com/rusinvadym)

## License

MIT
