# Visual Collaboration

> **Visual Collaboration Surface for Humans and AI Agents**  
> 把任何网页变成人与 AI 共同协作的标注、评审与演示工作台。

本项目是开源项目 **[thevrus/MarkLayer](https://github.com/thevrus/MarkLayer)**（Apache-2.0 许可证）的派生与功能扩展版本（Fork），当前维护于 `tokc2327-code/visual-collaboration`。本项目完全开源，不含商业化计费、激活码或权限锁，旨在探索人机协同在前端视觉层面的深度交互与执行闭环。

---

## 相对上游所做的工作

本项目在上游基线提交（`905a671`）的基础上，持续开发人机视觉协作与执行交互能力，在代码与工程层面实现了以下核心改动（均在仓库代码中核实）：

1. **交互式视觉教学演示（TeachLayer）**  
   - 在协作界面新增教学演示图层（`apps/worker/web/TeachLayer.tsx` 与 `@ext/lib/teaching`）。
   - 支持针对特定 DOM 元素挂载高亮指示框与字幕讲解，提供上一步、下一步、暂停、继续、退出控制。
   - 人类用户可通过工具栏主动发起演示，AI Agent 亦可通过 MCP 接口（`teach_start`、`teach_step`）远程驱动网页端按步演示。

2. **协同执行模式与权限约束（Execution Modes: Solo / Guide / Pair）**  
   - 在协同房间核心协议（`packages/types/src/wire.ts`）与 Durable Object 状态机（`apps/worker/src/annotation-room.ts`）中实现了三种执行模式：
     - **Solo**：常规无约束自由模式。
     - **Guide**：引导教学模式。Agent 仅允许演示与回答批注，服务端直接拦截拒绝 `resolve`、`dismiss` 和 `suggest_edit` 操作，问题保持 Open 状态。
     - **Pair**：结对协作模式。Agent 可以提交问题修复方案，但必须由人类在网页端点击“Approve”确认后方可合流闭环。

3. **图层笔迹与空间上下文纳入评论（Spatial Context in Comments）**  
   - 扩展了评论上下文构建逻辑（`apps/extension/lib/comment-context.ts`）。
   - 在落 Pin 创建 Comment 时，不再仅保存孤立文本，而是将当前图层周围的自由画笔（pen）、荧光高亮（highlight）、选区与几何图形（area/rectangle/circle）以及截图取样区域一并打包进 `visualContext`，让 AI Agent 能通过 MCP 读取完整的空间视觉线索。

4. **缩放补偿与锚点稳定性修复**  
   - 修复扩展在面对网页宿主动态 CSS `zoom` 时的逆变换补偿机制；统一点击落 Pin 时的视口几何快照，并在 Post 提交前随几何 tick 重锚（提交 `05d5550`）。
   - 完成 Windows 平台路径规范化、Preact 测试预加载环境与全仓 Monorepo 类型路径对齐。

---

## 核心功能与工作模式

基于当前仓库实际编译与运行能力，主要功能包括：

- **全功能批注覆盖层（Canvas & Annotation Layers）**：
  - 画笔（基于 `perfect-freehand` 平滑笔迹）、荧光高亮笔、橡皮擦。
  - 几何图形（矩形、圆形、直线、箭头）、文本标注。
  - 标尺参考线（`GuideLayer`，与常规标注一同参与 Op 流同步与持久化）。
- **空间感知评论（CommentLayer & Pins）**：
  - 智能捕获点击目标的稳定 DOM 选择器（CSS Selector + 文本指纹容错）。
  - 支持可调节尺寸的截图取样框（100~1600px 范围调节）。
  - 支持音频/视频批注录制、优先级（Priority）与处理状态（Status）跟踪。
- **DOM 审查与 AI Prompt 提取（Inspector）**：
  - 悬停即时高亮 DOM 节点并显示尺寸标尺。
  - 自动捕获计算盒模型、关键样式、React/Vue 组件标记，生成适合输入给 AI Coding Agent 的结构化 Markdown。
- **AI Agent MCP 服务端（`marklayer-mcp`）**：
  - 标准 Model Context Protocol stdio 接口。
  - 提供 `marklayer_list_annotations`、`marklayer_watch_annotations`、`marklayer_acknowledge`、`marklayer_resolve`、`marklayer_reply` 等工具，让 AI 具备读取与更新网页批注的能力。
- **双网页视觉对比（Visual Compare）**：
  - 在 `/compare` 路由下支持并排（Side by side）与卷帘滑块（Slider）双模式，双 Iframe 滚动通过 postMessage 保持同步。

---

## 快速开始

### 运行环境要求
- **OS**：Windows / macOS / Linux
- **运行时**：[Bun](https://bun.sh)（推荐 1.4.3 及以上版本）
- **Node.js**：20.x 或更高（供部分构建脚本调用）

### 1. 克隆仓库与安装依赖

```bash
git clone https://github.com/tokc2327-code/visual-collaboration.git
cd visual-collaboration
bun install
```

### 2. 本地开发启动

启动全仓所有子工程（基于 Turborepo）：

```bash
bun run dev
```

如需专注于后端服务与 Web Viewer，可直接启动本地 Worker 与 D1 数据库：

```bash
cd apps/worker
# 应用本地 D1 数据库迁移
bunx wrangler d1 migrations apply marklayer --local
# 启动本地 Wrangler 开发服务（端口 5173）
bunx wrangler dev --local --port 5173
```
浏览器打开 `http://127.0.0.1:5173` 即可进入 Web Viewer 界面。

### 3. 加载浏览器扩展（Chrome / Edge）

```bash
cd apps/extension
bun run dev
```

1. 打开 Chrome 或 Edge 浏览器，访问 `chrome://extensions/`。
2. 打开右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选择目录 `apps/extension/.output/chrome-mv3-dev`（或构建产物 `chrome-mv3`）。
5. 访问任意网页，点击扩展图标即可呼出标注与审查工具栏。

---

## 仓库结构

```
visual-collaboration/
├── apps/
│   ├── extension/       # 浏览器扩展 (WXT + Preact + Signals + Tailwind CSS v4)
│   ├── fetcher/         # 固定 IP 网页抓取中继 (反 WAF 拦截 fallback，3KB 独立服务)
│   ├── mcp/             # 面向 AI Agent 的 MCP stdio 服务端 (marklayer-mcp)
│   ├── site/            # 静态文档与使用场景说明 (Astro 7 + Tailwind CSS)
│   └── worker/          # Cloudflare Worker 全栈服务 (Hono + Durable Objects + D1 + Web Viewer)
├── packages/
│   ├── agent-tools/     # Agent 工具契约与 Zod Schema (无传输层抽象)
│   ├── brand/           # 品牌常量、图标与链接辅助
│   ├── emails/          # 基于 React-Email 的邮件模板组件
│   ├── tokens/          # 全局设计系统令牌 (theme.css)
│   ├── types/           # 共享 TypeScript 类型与 Zod 验证 (DrawOp, CommentOp, Wire 协议)
│   └── ui/              # 基础 UI 工具函数 (cn)
├── docs/                # 项目规范、审计、派活与阶段实施记录
└── acceptance/          # 本地真实双会话验收记录与截图证据
```

---

## 技术栈

从各子项目 `package.json` 实测核对：

- **运行时与包管理**：Bun (`bun@1.4.3` / `bun@1.3.14`)、Turborepo (`turbo@2.10.12`)
- **前端核心**：Preact (`10.29.8`)、Signals (`@preact/signals`)、Tailwind CSS (`v4.3.3`)、Base UI (`@base-ui/react` 1.7.0)
- **扩展框架**：WXT (`0.21.4`)，支持 Chrome MV3 与 Firefox
- **后端基础设施**：Cloudflare Workers、Hono (`4.13.5`)、Durable Objects（实时房间协同与信令）、D1 SQLite、R2 对象存储
- **Agent 协议**：Model Context Protocol (`@modelcontextprotocol/sdk` 1.30.0, `@modelcontextprotocol/server` 2.0.0)
- **文档渲染**：Astro (`7.2.9`)，配合 `@astrojs/markdown-remark`
- **代码规范**：Biome (`2.5.11`)、TypeScript (`typescript@^6` 用于根仓及 Astro 检查，`typescript@^7` 用于其他子包)

---

## 常用脚本

| 命令 | 适用位置 | 说明 |
| :--- | :--- | :--- |
| `bun run dev` | 根目录 | 启动全仓开发模式（Turbo 并行驱动） |
| `bun run build` | 根目录 | 执行全仓构建 |
| `bun run check` | 根目录 | 对所有工作区执行 TypeScript / Astro 类型检查 |
| `bun run test` | 根目录 | 运行全仓各工作区的单元测试（Bun Test） |
| `bun run lint` | 根目录 | 执行 Biome 代码风格与格式检查 |
| `bun run lint:fix` | 根目录 | 执行 Biome 自动修复 |
| `bun run zip:extension` | 根目录 | 打包 Chrome 与 Firefox 扩展 zip |
| `cd apps/worker && bun run deploy` | `apps/worker` | 构建并部署 Worker 至 Cloudflare |
| `cd apps/worker && bunx wrangler d1 migrations apply marklayer --local` | `apps/worker` | 向本地开发数据库应用 D1 迁移 |
| `cd apps/extension && bun dev:firefox` | `apps/extension` | 启动 Firefox 目标扩展开发模式 |
| `cd apps/mcp && bun run build` | `apps/mcp` | 编译独立 MCP 服务端为 `dist/cli.js` |

---

## 文档索引

`docs/` 目录下维护了本项目的所有核心设计、审计与实施记录：

- [`docs/visual-collaboration-progress.md`](docs/visual-collaboration-progress.md)  
  人机视觉协作六阶段实施记录清单。**特别注意：六个阶段目前均在推进与验证过程中，尚未全部勾选完成**。
- [`docs/gap-audit-2026-11-11-from-agy.md`](docs/gap-audit-2026-11-11-from-agy.md)  
  针对六阶段共 18 个条目的逐项代码落地差距审计报告。
- [`docs/dispatch-2026-11-11.md`](docs/dispatch-2026-11-11.md)  
  日常协同派活、最新测试覆盖基线与当前外部阻塞项记录。
- [`docs/UI-RULES-2026-11-11.md`](docs/UI-RULES-2026-11-11.md)  
  UI 铁律：所有界面调整严格遵守上游原生实现，严禁自创未经取证的样式与字面量。
- [`docs/ui-token-inventory-2026-11-11.md`](docs/ui-token-inventory-2026-11-11.md)  
  全仓排版、调色板与布局 Token 取证清单。
- [`docs/plugin-split-2026-11-11.md`](docs/plugin-split-2026-11-11.md)  
  开源功能包解耦与插件化拆分技术方案调研。
- [`docs/zoom-offset-investigation-from-oc.md`](docs/zoom-offset-investigation-from-oc.md)  
  浏览器缩放引起的视口几何偏移排查与修复方案。

根目录关键工程指导文件：
- [`FORK-NOTES.md`](FORK-NOTES.md)：派生说明、基线提交号与本机环境配置。
- [`CLAUDE.md`](CLAUDE.md)：仓库代码约定、架构设计要点与开发指引。

---

## 已知边界与未闭环项

本项目保持务实与严谨态度，在 `acceptance/README.md` 与进度文档中真实记录了现有实现的已知边界：

1. **真实浏览器 CDP 自动化端到端测试受限**：受宿主环境 Chrome 远程调试（CDP）连接授权限制，尚未实现无人工介入的完全自动化浏览器端到端验收；目前主要依赖本地两会话真实浏览器实操验证（详见 `acceptance/README.md`）。
2. **多模态视觉真实识别尚未完全闭环**：虽然评论上下文已在数据层完整纳入了截图取样与图层画笔信息，但在真实 AI 模型侧消费该图片并自主决策修改代码的实际链路仍需进一步实验核验。
3. **真实高分屏与浏览器缩放边缘情况**：项目内缩放（`zoomScale`）已实测正常，但物理真实高 DPR 显示器与原生浏览器缩放（`Ctrl + +`）下的边界自动裁切与坐标锁定机制尚未通过完备的跨设备实机矩阵测试。
4. **视口内可见 DOM 元素按需分批扫描（阶段三）待开发**：当前仅有点选光标提取（`pickElement`）和整页静态轮廓提取，视口内可见元素的流式分批扫描规范与实现仍在规划中。
5. **跨源 Iframe 限制**：Web Viewer 依赖 Worker 反向代理剥离 `X-Frame-Options`；对于高度防盗链或内网隔离网站，纯纯客户端 iframe 存在天然跨域策略约束。

---

## 许可证与署名

本项目基于 **Apache License 2.0** 许可证开源。

- **上游原始项目**：[thevrus/MarkLayer](https://github.com/thevrus/MarkLayer)
- **原始作者版权**：Copyright © [Dean Rusin](https://github.com/thevrus)
- **派生基线提交**：`905a671973c4451fb480761b61eeab35e90a2be5`
- **派生仓库说明**：本项目在保留原作者版权声明与许可证的前提下进行二次开发。详细协议内容参见根目录 [LICENSE](LICENSE)。
