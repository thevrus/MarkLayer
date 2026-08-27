<p align="center">
  <a href="https://marklayer.app">
    <img src=".github/icon.svg" width="112" height="112" alt="MarkLayer logo">
  </a>
</p>

<h1 align="center">MarkLayer</h1>

<p align="center"><strong>Website feedback without the screenshot thread.</strong></p>

<p align="center">
  Draw, highlight, and comment on any live webpage. Share one link and review together in real time, with no account required.
</p>

<p align="center">
  <a href="https://marklayer.app"><strong>Try MarkLayer</strong></a> ·
  <a href="https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc">Add to Chrome</a> ·
  <a href="#self-hosting--development">Build from source</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b47d6?style=flat-square" alt="Apache-2.0 license"></a>
  <a href="https://marklayer.app"><img src="https://img.shields.io/badge/no%20account-required-1f9d68?style=flat-square" alt="No account required"></a>
  <a href="https://github.com/thevrus/MarkLayer"><img src="https://img.shields.io/github/stars/thevrus/MarkLayer?style=flat-square" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://marklayer.app"><img src="https://raw.githubusercontent.com/thevrus/MarkLayer/main/apps/worker/static/product-review-wikipedia.webp" alt="A MarkLayer review board open on Wikipedia, showing highlights, threaded comments, and live cursors" width="900"></a>
</p>

## One URL. A shared board. A faster decision.

MarkLayer turns any webpage into a collaborative review surface. Instead of passing screenshots back and forth, send a link. Teammates or clients can open the original page in their own browser, leave feedback where it belongs, and see changes land live.

- **For client feedback**: let clients point to exactly what they mean, without an account or extension.
- **For design review**: sketch ideas, highlight details, and keep the conversation attached to the page.
- **For QA**: pin reproducible issues to the actual UI, then share a clean link with the team.
- **For AI-assisted work**: inspect an element to copy its stable selector and an AI-ready markdown snapshot.

## How it works

1. **Open a page**: paste any public URL at [marklayer.app](https://marklayer.app), or use the Chrome extension on the page you are already viewing.
2. **Make the feedback visible**: draw, highlight text, measure space, pin a threaded comment, or inspect an element.
3. **Share one link**: collaborators join the same board and see cursors, marks, replies, and calls in real time.

No sign-up. No trial clock. No client install.

## What you can do

| | |
|---|---|
| **Annotate freely** | Pen, highlighter, eraser, shapes, arrows, text, and text-selection highlights. |
| **Keep feedback in context** | Pin threaded comments to the page, reply inline, and track status. |
| **Review live** | Real-time cursors, drawings, and comments via WebSocket, plus peer-to-peer voice and video chat. |
| **Hand off precise implementation context** | Inspect an element for a stable selector, computed styles, parent layout, viewport details, and framework component information. |
| **Measure the UI** | Check element dimensions and edge-to-edge gaps between two elements. |
| **Share or export** | Create shareable links with preview cards, or export annotations to PNG. |
| **Make it yours** | Reorder toolbar tools; drafts persist locally and restore when you return. |

## Built to respect the reviewer's time and privacy

- **No accounts or tracking**: start reviewing immediately.
- **Links expire thoughtfully**: shared boards expire 90 days after their last view.
- **Open source and self-hostable**: MarkLayer is released under [Apache-2.0](LICENSE), so your workflow is not tied to a pricing change.

Want the non-technical version? Read [How MarkLayer works](https://marklayer.app/guides/how-marklayer-works).

## Self-hosting & development

~~~bash
git clone https://github.com/thevrus/MarkLayer.git
cd MarkLayer
bun install
bun run dev
~~~

For the Chrome extension in development:

1. Build or run the extension app.
2. Open <code>chrome://extensions/</code> and turn on **Developer mode**.
3. Choose **Load unpacked** and select <code>apps/extension/.output/chrome-mv3-dev</code>.

### Repository layout

~~~
├── apps/extension/     Chrome extension (WXT + Preact)
├── apps/worker/        Cloudflare Worker, API, real-time rooms, proxy, OG generator
├── apps/site/          Static marketing site (Astro)
└── packages/types/     Shared TypeScript types
~~~

### Stack

| Area | Technologies |
|---|---|
| Frontend | Preact, Signals, Tailwind CSS, Vite |
| Extension | WXT, Chrome APIs |
| Backend | Cloudflare Workers, Hono, Durable Objects |
| Storage | D1 (SQLite), R2 |
| Real-time | WebSockets, WebRTC |

### Scripts

| Command | What it does |
|---|---|
| <code>bun run dev</code> | Run the workspace in development mode |
| <code>bun run build</code> | Build all apps |
| <code>bun run check</code> | Type-check the workspace |
| <code>bun run lint</code> | Lint and format-check with Biome |
| <code>bun run lint:fix</code> | Apply lint and formatting fixes |
| <code>cd apps/worker && bun run deploy</code> | Deploy the Worker to Cloudflare |

## Contributing

Found a bug or have an idea? [Open an issue](https://github.com/thevrus/MarkLayer/issues). Contributions are welcome.

## License

[Apache License 2.0](LICENSE) © [Vadym Rusin](https://github.com/thevrus)

---

<p align="center">
  <a href="https://marklayer.app">Try MarkLayer</a> ·
  <a href="https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc">Add to Chrome</a> ·
  <a href="https://github.com/thevrus/MarkLayer/issues">Report a bug</a> ·
  <a href="https://github.com/thevrus/MarkLayer/issues">Request a feature</a>
</p>
