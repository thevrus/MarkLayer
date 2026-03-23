<p align="center">
  <a href="https://marklayer.app"><img src=".github/icon.svg" width="128" height="128" alt="MarkLayer"></a>
</p>

# MarkLayer

> Annotate any webpage with drawings, comments, and highlights. Real-time collaboration for Chrome.

**MarkLayer** is a free, open-source web annotation tool. Draw, highlight, comment on any page — then share a link for real-time collaboration. No sign-up required.

[Try it live](https://marklayer.app) · [Chrome Web Store](https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc) · [Build from source](#from-source)

## ✨ Features

- 🖊️ **Drawing tools** — pen, highlighter, eraser, shapes, arrows, text
- 💬 **Threaded comments** — pin anywhere, reply inline, track status
- ✍️ **Text selection** — highlight text and annotate it
- 👥 **Real-time collaboration** — live cursors, drawings, and comments via WebSocket
- 🎙️ **Voice & video chat** — peer-to-peer via WebRTC with TURN fallback
- 🔗 **Shareable links** — one link with OG preview cards
- 💾 **Draft auto-save** — annotations persist locally and restore on revisit
- 📸 **Export to PNG** — save annotations as an image
- 🔒 **Privacy-first** — no accounts, no tracking, auto-expires after 30 days

## 🚀 Quick Start

### Web App

Go to **[marklayer.app](https://marklayer.app)**, paste a URL, done.

### From Source

```bash
git clone https://github.com/thevrus/MarkLayer.git
cd MarkLayer && bun install

bun run dev           # all apps
cd apps/worker        # web app only
cd apps/extension     # extension only
```

Load the extension: `chrome://extensions/` → Developer mode → Load unpacked → `apps/extension/.output/chrome-mv3-dev`

## 🏗️ Architecture

```
├── apps/extension/     Chrome extension (WXT + Preact)
├── apps/worker/        Cloudflare Worker (Hono + Preact)
│   ├── src/            API, WebSocket rooms, OG gen, proxy
│   └── web/            Landing page + annotation viewer
└── packages/types/     Shared TypeScript types
```

| | Stack |
|---|---|
| **Frontend** | Preact + Signals, Tailwind v4, Vite |
| **Extension** | WXT, Chrome APIs |
| **Backend** | Cloudflare Workers, Hono, Durable Objects |
| **Database** | D1 (SQLite) + R2 (OG cache) |
| **Real-time** | WebSocket via Durable Objects, WebRTC (voice/video) |

## 🛠️ Scripts

| Command | |
|---|---|
| `bun run dev` | Dev mode (Turborepo) |
| `bun run build` | Build all |
| `bun run check` | TypeScript check |
| `bun run lint` | Biome lint + format |
| `bun run lint:fix` | Auto-fix |
| `cd apps/worker && bun run deploy` | Deploy to Cloudflare |

## 📄 License

MIT © [Vadym Rusin](https://github.com/thevrus)

---

[Try it live](https://marklayer.app) · [Report Bug](https://github.com/thevrus/MarkLayer/issues) · [Request Feature](https://github.com/thevrus/MarkLayer/issues)
