# 视觉协作项目插件化拆分与开源模块化方案调研报告 (2026-11-11)

> **调研背景**：为推进项目模块化建设与开源社区化运作，将现有单体仓库解构为「已验证完整功能的独立开源插件/功能包」，使外部开发者或下游项目能够单独 clone、安装、引入或二次开发。本报告对当前仓库代码资产进行全量静态盘点，剖析各模块职责、依赖拓扑与解耦阻碍，制定开源拆分方案与最小文件清单，详列各插件可直接实操复现的闭环验收指南，评估社区可用性排序，并就开源生态下的单仓（Monorepo）维护给出明确架构建议。

---

## 一、现状盘点：Apps 与 Packages 资产审计

全仓包含 5 个子应用（`apps/*`）与 6 个公共包（`packages/*`）。以下根据各模块的 `package.json`（name、version、private 状态）、源码引用及运行时耦合情况进行审计：

### 1.1 `apps/*` 审计

| 应用目录 | 包名 (`name`) | 版本 | `private` | 核心职责 | 依赖项 (内部 / 外部) | 独立发布阻碍与解耦现状 |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| `apps/extension` | `@marklayer/extension` | 0.11.0 | `true` | Chrome MV3 / Firefox 浏览器扩展。在任意网页（含 localhost）注入 Shadow DOM 覆盖层；提供画笔、荧光笔、矩形/椭圆、箭头、文本、标尺导线等全套 Canvas 批注；DOM 元素审查器与 CSS 选择器捕获；锚点重定位算法；带优先级/状态的 Comment Pin；截屏/音视频录制；本地 IndexedDB 离线存储。 | **内部**：`types`, `agent-tools`, `brand`, `tokens`, `ui`<br>**外部**：`@base-ui/react`, `@preact/signals`, `idb-keyval`, `lucide-preact`, `nanoid`, `perfect-freehand`, `preact`, `simple-icons`, `tinykeys` | **严重耦合，目前无法单独开源发布**：<br>1. 被 `apps/worker` 深度反向引用（worker 内有 28 个文件直接通过 `@ext/*` 路径别名引用其源码，如 `buttons`, `geist`, `tool-state`, `ops` 等）。<br>2. 其子目录 `widget/` 构建由 worker 的 build 脚本触发。<br>3. 云端协同强绑定 `https://marklayer.app`，缺乏独立单机/自建服务配置项。 |
| `apps/fetcher` | `@marklayer/fetcher` | 0.1.0 | `true` | 解决 Cloudflare 共享边缘 IP 被目标网站 WAF（如 SiteGround）拦截的问题，提供单端点、固定公网 IP 的透明抓取中继服务。3KB 独立包，真实 UA 标识，带 DNS 解析端 SSRF 防护。 | **内部**：`brand`, `types`<br>**外部**：零外部依赖（Node/Bun 标准库） | **不宜作为独立插件分发**：<br>纯后端底层基础设施代理，无任何用户界面或交互，仅作为 Worker 反代被 WAF 挑战时的静默 fallback。 |
| `apps/mcp` | `marklayer-mcp` | 0.6.1 | **`false`** | 专为 AI Coding Agent（Claude Desktop、Cursor、Cline 等）打造的标准 MCP stdio 服务端。将 MarkLayer 房间的标注、评论和页面元素暴露为 MCP 工具（`marklayer_watch_annotations`, `marklayer_acknowledge`, `marklayer_resolve` 等）。 | **内部(构建内联)**：`agent-tools`, `brand`, `types`<br>**外部**：`@modelcontextprotocol/sdk`, `nanoid`, `ws`, `zod` | **已具备独立开源发布能力（npm）**：<br>已在 npm 公开发布。但**业务依赖远端房间**：运行时默认通过 WebSocket 连接 MarkLayer 的云端 DO 房间。单发版需支持自建房间 URL 或本地 Mock 模式。 |
| `apps/site` | `@marklayer/site` | 0.0.0 | `true` | 基于 Astro 的静态营销与 SEO 文档站点。包含竞品对比（`/vs/*`）、替代方案（`/alternatives/*`）、OpenAPI 文档与 Agent 引导元数据。 | **内部**：`agent-tools`, `brand`, `tokens`, `types`<br>**外部**：`astro`, `@lucide/astro`, `simple-icons`, `tinykeys` | **不可作为独立插件分发**：<br>纯文档/内容站。构建产物通过 `embed:site` 强制拷入 `apps/worker/public/client` 由边缘统一托管；且锁死 `typescript@^6`（Astro 编译 API 限制）。 |
| `apps/worker` | `@marklayer/worker` | 0.0.0 | `true` | Cloudflare 全栈中枢：Hono 路由、Durable Objects 协同房间（唯一写入源/WebSocket 广播/WebRTC 信令）、D1 数据存储、R2 静态/附件存储、网页 Viewer 界面（`/s/:id`）、双页对比（`/compare`）、Dashboard、Slack 双向集成、网页反代（`/proxy`）。 | **内部**：所有 packages + `apps/site` + 反向别名引用 `apps/extension`<br>**外部**：`hono`, `@base-ui/react`, `@preact/signals`, `@resvg/resvg-wasm`, `wouter-preact`, `wrangler` 等 | **单体全栈服务，不作为前端插件开源**：<br>与 extension、site 双向缠绕，强依赖 Cloudflare 专有云基础设施（DO、D1、R2）。可作为全栈自建参考，不可作轻量插件。 |

### 1.2 `packages/*` 审计

| 包目录 | 包名 (`name`) | 版本 | `private` | 核心职责 | 依赖项 | 独立开源现状 |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| `packages/agent-tools` | `@marklayer/agent-tools` | 0.6.1 | `true` | 抽象传输层的 AI Agent 工具契约规范。定义 MCP 工具声明、Zod mini 检验 Schema、评论与标注数据对外脱敏投影及演示核心状态机。 | `brand`, `types`, `zod` | 纯内部共享契约包，无独立运行入口；构建期内联至 `apps/mcp` 与 `apps/worker`。 |
| `packages/brand` | `@marklayer/brand` | 0.0.0 | `true` | 品牌资源包。管理 SVG 图标、Logo、固定主域常数（`ORIGIN`）及 URL 处理工具。 | 无内部依赖 | 纯常量资产包，无独立分发必要。 |
| `packages/emails` | `@marklayer/emails` | 0.0.0 | `true` | 邮件模板包。基于 React-Email 编写邀请和免密登录邮件模板，编译为 HTML 和纯文本。 | `brand`, `tokens` | 仅含模板视图，无邮件发送运行时，不作独立插件。 |
| `packages/tokens` | `@marklayer/tokens` | 0.0.0 | `true` | 设计系统令牌。维护 `theme.css`（颜色阶梯、排版尺寸、间距），供全仓前端样式表共同引用。 | 无内部依赖 | 静态 CSS 资产。 |
| `packages/types` | `@marklayer/types` | 0.0.0 | `true` | 全仓 TypeScript 类型与 Zod 验证基石。定义 `DrawOp`、`CommentOp`、网络通讯协议、SSRF 黑名单。 | `brand`, `zod` | 核心类型基础设施，作为 `workspace:*` 供内部工程使用。 |
| `packages/ui` | `@marklayer/ui` | 0.0.0 | `true` | UI 样式工具包。导出基于 `cnfast` 的类名合并函数 `cn` 及排版计算工具。 | `cnfast` | 基础函数包，建议作为辅助代码内联。 |

---

## 二、拆分方案：独立分发的开源插件与功能包

以「开箱即用、开源分发（npm / GitHub Releases / 独立 CDN Script）、零成本本地跑通」为原则，将全仓切分为 **5 个独立开源候选插件** 与 **4 个内部支撑/半成品模块**：

```
                    ┌──────────────────────────────────────────────┐
                    │               MarkLayer 开源仓库             │
                    └──────┬───────────────┬───────────────┬───────┘
                           │               │               │
        ┌──────────────────┴──┐   ┌────────┴─────────┐   ┌─┴────────────────┐
        │  AI 编程协作插件     │   │  客户端与工具插件  │   │  内部支撑/暂不独立│
        ├─────────────────────┤   ├──────────────────┤   ├──────────────────┤
        │ 1. marklayer-mcp    │   │ 3. web-widget    │   │ 6. slack-sync    │
        │ 2. inspect-copy     │   │ 4. visual-compare│   │ 7. fetcher       │
        │                     │   │ 5. standalone-ext│   │ 8. site / emails │
        └─────────────────────┘   └──────────────────┘   └──────────────────┘
```

### 候选开源包概览与分发形态

1. **`marklayer-mcp` (AI 编程助手双向协作 MCP 插件)**
   - **一句话功能**：让 Cursor / Claude Desktop / Cline 直接看懂网页视觉标注，自动认领、修复代码并闭环反馈。
   - **开源分发形态**：npm 包（`npx -y marklayer-mcp`）+ GitHub 源码发布。
   - **依赖包**：`@marklayer/agent-tools`, `@marklayer/types`（构建时已用 Bun 内联，零外部内部包依赖）。
   - **解耦改动**：目前默认连接 `https://marklayer.app`，需增加环境变量 `MARKLAYER_ROOM_URL` 支持用户自建房间或本地 Mock 模式。

2. **`@marklayer/inspect-copy` (AI 网页上下文审查与 Prompt 生成扩展)**
   - **一句话功能**：专为前端和 AI 编程打造的轻量浏览器扩展，点击任意 DOM 瞬时生成防漂移 CSS 选择器、计算样式、布局与组件层级，一键复制为 LLM 结构化 Prompt。
   - **开源分发形态**：GitHub Releases 提供 Chrome / Firefox 离线 `.zip` 解压包 + Chrome Web Store 免费上架。
   - **依赖包**：`@marklayer/types` (部分), `@marklayer/ui`, `@base-ui/react`, `preact`。
   - **解耦改动**：从主扩展中剥离涂鸦画布与协同逻辑，打包成小于 100KB 的独立 WXT 扩展。**100% 纯前端运行，零服务器依赖**。

3. **`@marklayer/web-widget` (站长可嵌入式访客即时反馈挂件)**
   - **一句话功能**：开源网站反馈挂件，站长在网页引入一行 `<script>`，访客无需安装任何插件即可在右下角唤起截屏批注抽屉，将缺陷提交至自定义 Webhook。
   - **开源分发形态**：jsDelivr / unpkg CDN 托管单文件脚本 + npm 包 + GitHub Release `widget.js`。
   - **依赖包**：`@marklayer/tokens`, `@marklayer/ui`, `@marklayer/types`。
   - **解耦改动**：将构建流程脱离 Worker，支持通过 `data-endpoint="https://api.myproject.com/webhook"` 自定义上报地址。

4. **`@marklayer/visual-compare` (双网页视觉比对与滚动同步插件)**
   - **一句话功能**：前端开发与重构比对工具，同屏双 Iframe 并排或滑动卷帘对比生产 vs 测试页面，双视口像素级滚动强力同步。
   - **开源分发形态**：独立 npm 组件（React/Preact 组件包）+ 独立静态 SPA 部署模板（Vercel/Cloudflare Pages 一键部署）。
   - **依赖包**：`@base-ui/react`, `@preact/signals`, `preact`, `wouter-preact`, `@marklayer/ui`。
   - **解耦改动**：需说明跨域网站加载限制（CORS / X-Frame-Options），提供本地同源模式或附带轻量反代配置。

5. **`@marklayer/standalone-extension` (无账户独立网页标注与走查扩展)**
   - **一句话功能**：无需注册、完全离线的开源网页走查与标注客户端，支持画笔、箭头、标尺、评论 Pin，支持 IndexedDB 本地保存与高清截图导出。
   - **开源分发形态**：GitHub Releases 提供解压即用的扩展安装包（`.zip` / `.crx` / `.xpi`）。
   - **依赖包**：`@marklayer/types`, `@marklayer/agent-tools`, `@marklayer/brand`, `@marklayer/tokens`, `@marklayer/ui`。
   - **解耦改动**：将默认的“云端分享”降级为可选配置，默认开启纯本地离线工作流。

---

## 三、每个插件「完整闭环功能」四栏详查（开源使用者实操版）

严格按照 **【入口】·【动作】·【可见结果】·【验收】** 四栏标准编写，验收步骤均面向开源使用者可直接复现：

### 插件 1：`marklayer-mcp` (AI 编程助手协作插件)
- **入口**：本地终端 CLI 或 AI 客户端配置（Claude Desktop `claude_desktop_config.json` / Cursor MCP 设置）。
- **动作**：
  1. 用户在终端配置 `npx -y marklayer-mcp --room <ROOM_URL>` 并启动。
  2. 在 AI 对话窗口发送：“读取房间标注，逐条认领并修复当前页面的样式问题”。AI 自动调用 `marklayer_watch_annotations` 与 `marklayer_acknowledge`。
- **可见结果**：
  - 终端输出 MCP JSON-RPC 通讯日志；AI 聊天窗口打印出包含目标元素 CSS 选择器、视口坐标与报错信息的结构化 Markdown。
  - 网页审查端对应评论状态灯实时由黄色（待处理）变为蓝色（已认领）。
  - AI 修改本地代码后调用 `marklayer_resolve`，网页端评论状态变绿（已解决）并附带修复提交日志。
  - 数据保存在协同房间内存中并通过 WebSocket 广播。
- **开源实操验收步骤**：
  ```bash
  # 1. 运行单测验证 MCP 工具规格契约
  bun test apps/mcp
  # 2. 构建独立单文件 CLI
  cd apps/mcp && bun run build
  # 3. 本地启动 MCP 服务并发送 stdio 握手包验证
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/cli.js
  # 预期输出：返回包含 marklayer_list_annotations、marklayer_acknowledge 等 6 个工具的 JSON 响应，退出码 0
  ```

### 插件 2：`@marklayer/inspect-copy` (AI 网页上下文审查与 Prompt 提取器)
- **入口**：浏览器扩展栏图标点击，或网页内快捷键 `Alt+I`。
- **动作**：光标在目标网页上悬停移动，点击任意 DOM 元素；在弹出的悬浮 Inspector 卡片中点击“Copy AI Markdown”。
- **可见结果**：
  - 目标元素被半透明蓝色高亮框精准覆盖，右上角附带标签名与尺寸标尺。
  - 悬浮卡片展示唯一 CSS 选择器路径（如 `main > section.hero > button.primary`）、计算盒模型与 React Fiber 组件名。
  - 屏幕弹出“Copied to Clipboard”提示；剪贴板内获得包含选择器、样式、视口相对坐标和提示词上下文的标准 Markdown 文本。
  - **数据存储**：纯本地内存与剪贴板，无任何网络请求与外部存储。
- **开源实操验收步骤**：
  ```bash
  # 1. 运行核心选择器与锚点单元测试
  bun test apps/extension/lib/selector.test.ts apps/extension/lib/anchor.test.ts
  # 2. 开发者模式加载 Chrome 扩展
  # 打开 chrome://extensions/ -> 开启“开发者模式” -> 点击“加载已解压的扩展程序” -> 选择 apps/extension/.output/chrome-mv3-dev
  # 3. 访问 https://example.com，按下 Alt+I，点击页面中唯一 <h1> 标签
  # 4. 点击面板“Copy AI Markdown”，在终端执行 pbpaste (Mac) 或 Get-Clipboard (Windows)，验证粘贴文本包含精确的 selector 与 computed styles
  ```

### 插件 3：`@marklayer/web-widget` (可嵌入式访客即时反馈挂件)
- **入口**：宿主网站右下角（或左下角）常驻的悬浮圆角按钮。
- **动作**：网站访客点击悬浮按钮，页面滑出半屏反馈抽屉；点击“截屏标注”，在截取的视口画布上绘制红框并输入反馈文字，点击“提交”。
- **可见结果**：
  - 屏幕上显示“反馈提交成功”Toast，抽屉平滑向下滑出关闭。
  - 浏览器网络面板显示向配置的 `data-endpoint` 发送了一个携带 PNG Base64/Blob、当前 URL、UA、窗口尺寸与批注坐标的 POST 请求。
  - 站长接收端（如自建 Webhook 或本地服务）收到结构化 JSON 数据。
- **开源实操验收步骤**：
  ```bash
  # 1. 执行 widget 独立打包构建
  bun apps/extension/widget/build.ts apps/worker/public/client
  # 2. 在任意本地 HTML 页面加入测试标签并启动本地静态服务器
  echo '<script src="http://localhost:5173/widget.js" data-project="demo" data-endpoint="http://localhost:8080/hook"></script>' > test.html
  # 3. 浏览器访问 test.html，观察页面右下角渲染出固定定位按钮
  # 4. 点击按钮唤起抽屉，绘制标注并提交，验证本地 8080 端口成功接收到 Webhook Payload
  ```

### 插件 4：`@marklayer/visual-compare` (双网页视觉比对与滚动同步插件)
- **入口**：Web 页面（如访问本地 `http://localhost:5173/compare`）。
- **动作**：在顶部控制栏输入 URL A 和 URL B，切换“Side by side (并排)”或“Slider (卷帘)”模式，在任意一侧页面内滚动鼠标。
- **可见结果**：
  - 页面同屏加载两个 Iframe 视图，中间展示可拖拽的分割调节线。
  - 滚动左侧页面，右侧页面通过 postMessage 协议瞬间等距滚动；拖动分割条，实时显示前后两版的遮罩切片。
  - 状态（URL、模式、分界百分比）自动同步在浏览器 URL Query 参数中。
- **开源实操验收步骤**：
  ```bash
  # 1. 运行 URL 解析与对比单测
  bun test apps/worker/web/compare/url.test.ts
  # 2. 启动本地 Worker 开发服务
  cd apps/worker && bunx wrangler dev --local --port 5173
  # 3. 浏览器打开 http://localhost:5173/compare?a=https://example.com&b=https://example.org&mode=side
  # 4. 在左侧页面向下滚动 200px，验证右侧页面同步滚动 200px，控制台无报错
  ```

### 插件 5：`@marklayer/standalone-extension` (无账户独立网页标注与走查扩展)
- **入口**：浏览器右上角扩展栏图标。
- **动作**：点击图标呼出浮动工具栏，使用画笔在页面绘制圈注，使用 Comment 工具点击文字留下批注，使用 Measure 工具测量两个按钮间距。
- **可见结果**：
  - 标注随页面滚动自适应重锚吸附；刷新页面后，标注数据自动从本地 IndexedDB（`idb-keyval`）恢复。
  - 点击工具栏“导出”，本地浏览器下载合成好的全幅网页标注截图。
- **开源实操验收步骤**：
  ```bash
  # 1. 编译 Chrome MV3 扩展包
  cd apps/extension && bun run build
  # 2. 在 chrome://extensions 加载 apps/extension/.output/chrome-mv3
  # 3. 打开任意网站，点击扩展图标唤起工具栏，使用矩形工具绘制红框，使用文本工具输入文字
  # 4. 刷新页面（F5），确认红框和文字依然留在原地；点击导出按钮，确认浏览器下载 output.png
  ```

---

### 半成品清单（暂不具备独立开源分发条件）

| 模块名 | 缺失项与暂不独立分发原因 |
| :--- | :--- |
| **`@marklayer/slack-sync` (Slack 协同机器人)** | **【半成品，不宜单发】**<br>· **缺独立前台配置**：仅为一组 Webhook / OAuth 接口，缺少自托管的配置与管理 UI。<br>· **缺通用存储驱动**：硬编码依赖 Cloudflare D1 的 `integrations` 数据表，脱离 Worker 无法独立作为开源 Slack App 部署。 |
| **`@marklayer/fetcher` (反 WAF 固定 IP 中继)** | **【底层支撑，无需单发】**<br>· **定位为纯运维基础设施**：无用户交互界面，只是一个 3KB 的 HTTP 代理脚本，独立开源缺乏应用场景，保留在仓库作为内建工具即可。 |
| **`apps/site` (Astro 营销与文档库)** | **【纯文档内容，不作独立插件】**<br>· 纯静态 Astro 内容站点，并非功能软件，构建与路由深度融入 Worker 静态资源托管。 |
| **`packages/emails` (邮件模板库)** | **【UI 辅助包，不作独立插件】**<br>· 仅含 2 个静态 React-Email 模板组件，无邮件投递运行时支持。 |

---

## 四、开源拆分清单（技术解耦落地规范）

本节为后续真正将包抽离为独立开源子项目或独立目录提供详尽的操作清单：

### 4.1 `marklayer-mcp` 开源拆分清单

- **最小文件集**：
  - 核心入口：`apps/mcp/src/cli.ts`, `server.ts`, `room.ts`
  - 契约定义：`packages/agent-tools/src/index.ts`, `prompt.ts`, `room-core.ts`, `tools.ts`
  - 类型支持：`packages/types/src/agents.ts`, `wire.ts`, `ops.ts`
  - 构建配置：`apps/mcp/package.json`, `tsconfig.json`, `server.json`
- **依赖仓库里哪些内部包**：`@marklayer/agent-tools`, `@marklayer/types`, `@marklayer/brand`。
- **独立后需修改的 Import 与环境变量**：
  - 将 `import ... from '@marklayer/agent-tools'` 与 `@marklayer/types` 改为相对路径引用本地 `src/core/*` 目录（或发为独立的 npm 包引用）。
  - 新增环境变量配置支持：
    - `MARKLAYER_ROOM_URL`：指定协同房间 WebSocket 地址（默认支持本地 `ws://localhost:5173` 或远端 `wss://marklayer.app`）。
    - `MARKLAYER_AGENT_ID`：指定当前 Agent 标识（默认 `coding-agent`）。
- **README 必备章节**：
  1. `Introduction`（一句话说明：Bridge MarkLayer annotations to Claude Desktop & Cursor）。
  2. `Quickstart (Claude Desktop)`（展示标准 `claude_desktop_config.json` 配置片段）。
  3. `Quickstart (Cursor)`（展示 Cursor MCP 工具添加配置）。
  4. `Available Tools`（完整列出 `marklayer_watch_annotations`、`marklayer_acknowledge`、`marklayer_resolve` 的参数说明）。
  5. `Local Development & Testing`（说明如何跑 `bun test` 与本地调试）。
- **可直接复用的验收脚本**：
  - `apps/mcp/src/manifest.test.ts`（检查 MCP 协议与注册清单匹配度）。
  - `apps/mcp/src/server.test.ts`（模拟 stdio 工具调用生命周期）。

---

### 4.2 `@marklayer/inspect-copy` 开源拆分清单

- **最小文件集**：
  - 审查视图层：`apps/extension/components/InspectorLayer.tsx`, `InspectorMarkerLayer.tsx`, `MultiInspectLayer.tsx`, `CssEditor.tsx`
  - DOM 与选择器核心：`apps/extension/lib/selector.ts`, `anchor.ts`, `dom.ts`, `portal.ts`
  - 基础扩展工程：独立 `wxt.config.ts`, `package.json`, `entrypoints/content.ts`
- **依赖仓库里哪些内部包**：`@marklayer/types` (提取其中约 20 行 `TargetElement` 类型定义), `@marklayer/ui` (提取 `cn` 工具函数)。
- **独立后需修改的 Import 与环境变量**：
  - 将 `@ext/lib/ops` 或全局信号引用移除，改为组件内私有状态。
  - 将 `@marklayer/types` 替换为本地内联的 `types.ts`。
  - 将 `@marklayer/ui/cn` 替换为直接依赖 `clsx` + `tailwind-merge`。
  - **环境变量**：零环境变量（纯本地扩展）。
- **README 必备章节**：
  1. `Features`（高精度防漂移选择器、盒模型提取、一键复制 AI 友好 Markdown）。
  2. `Installation`（GitHub Releases 下载 zip 解压，Chrome 开发者模式一键加载）。
  3. `Keyboard Shortcuts`（默认快捷键与自定义方式）。
  4. `Privacy`（明确声明：100% 离线本地运行，不上传任何网页 DOM 或网络请求）。
- **可直接复用的验收脚本**：
  - `apps/extension/lib/selector.test.ts`（涵盖各种复杂 DOM 结构的稳定路径测试）。
  - `apps/extension/lib/anchor.test.ts`（验证页面重排时的锚点吸附算法）。

---

### 4.3 `@marklayer/web-widget` 开源拆分清单

- **最小文件集**：
  - 挂件入口：`apps/extension/widget/loader.ts`, `WidgetApp.tsx`, `app.tsx`, `styles.ts`
  - 轻量组件：`apps/extension/widget/lite/*` (`ScreenCapture.tsx`, `CommentTriage.tsx`, `icons.tsx`)
  - 选区与标注：`apps/extension/components/AreaMarkup.tsx`, `apps/extension/lib/area-rect.ts`
  - 构建脚本：`apps/extension/widget/build.ts`
- **依赖仓库里哪些内部包**：`@marklayer/tokens/theme.css`, `@marklayer/ui/cn`, `@marklayer/types`。
- **独立后需修改的 Import 与环境变量**：
  - 将 `build.ts` 中写死的 `public/client` 输出路径改为输出至本地 `dist/widget.js`。
  - 改造 `loader.ts`，支持读取 `<script>` 标签属性：
    - `data-endpoint`（必须）：接收反馈数据的 Webhook URL。
    - `data-project`（可选）：项目识别标识。
    - `data-side`（可选）：按钮位置 `left` 或 `right`（默认 `right`）。
- **README 必备章节**：
  1. `Usage`（演示 `<script src="https://cdn.jsdelivr.net/.../widget.js" data-endpoint="..."></script>`）。
  2. `Webhook Payload Specification`（给出上报 JSON 数据格式定义）。
  3. `Self-Hosting Backend`（提供 10 行简易 Node/Bun Webhook 接收示例）。
  4. `Customization`（按钮颜色、文字、位置配置说明）。
- **可直接复用的验收脚本**：
  - `apps/extension/widget/build.test.ts`（验证打包产物为单文件无外部依赖 JS）。
  - `apps/extension/widget/match.test.ts`（验证页面路径匹配逻辑）。

---

## 五、开源落地排序（按「工作量 ÷ 独立可用性」）

排序原则：**工作量越小、外部开发者拿到后越能零依赖直接跑通（独立可用性越高），比值越小，社区落地优先级越高**。

```
              低工作量, 高独立可用性 (最易开源跑通)
  高 ▲
     │  [Top 1] marklayer-mcp
     │    (npm 已发布, 0.5天工作量, 开箱即连)
独   │
立   │  [Top 2] @marklayer/inspect-copy
可   │    (纯客户端, 2-3天工作量, 零服务器依赖)
用   │
性   │  [Top 3] @marklayer/web-widget
     │    (单脚本嵌入, 3-5天工作量, 需配置接收端)
     │
  低 └────────────────────────────────────────►
     低                    工作量             高
```

### Top 3 推荐顺序与深度理由

#### 🥇 第 1 名：`marklayer-mcp` (AI 编程助手协作 MCP 插件)
- **工作量评估**：★☆☆☆☆（**极小，约 0.5 ~ 1 人天**）
  - 现状：代码高度自洽在 `apps/mcp`，并且在 npm 已经有公开包 `marklayer-mcp` (0.6.1)。构建脚本可将所有内部包一并内联编译为单个 `dist/cli.js`。
  - 改造：仅需补齐自建房间配置参数和更友好的开源使用说明。
- **独立可用性评估**：★★★★★（**极高**）
  - 开发者只要本地有 Node/Bun 环境，一行 `npx -y marklayer-mcp` 即可在 Cursor / Claude Desktop 中无缝跑通，开箱即用感极佳。
- **结论**：**投入最小、见效最快，最适合打头阵作为核心开源工具**。

#### 🥈 第 2 名：`@marklayer/inspect-copy` (AI 网页审查与 Prompt 生成器)
- **工作量评估**：★★☆☆☆（**小，约 2 ~ 3 人天**）
  - 现状：核心算法（`selector.ts`, `anchor.ts`, `InspectorLayer.tsx`）在现扩展中非常稳定，代码健全度高。
  - 改造：只需建立一个精简的独立 WXT 扩展骨架，将审查层与选择器代码迁入，剥离画布与 WebRTC。
- **独立可用性评估**：★★★★☆（**极高**）
  - **最大优势：100% 纯客户端本地运行！** 任何人从 GitHub Release 下载 zip，拖进 Chrome 就能用，不需要启动任何后台，不依赖任何第三方云服务。
- **结论**：**真正零服务器运维成本，对社区开发者最友好，排第 2**。

#### 🥉 第 3 名：`@marklayer/web-widget` (可嵌入式客户反馈挂件)
- **工作量评估**：★★★☆☆（**中等，约 3 ~ 5 人天**）
  - 现状：`apps/extension/widget` 原型代码成熟度高达 80%，已具备极小的 `lite/` 模式与截图组件。
  - 改造：让其完全脱离 Worker 构建，增加通用 Webhook 上报配置与接收端示例。
- **独立可用性评估**：★★★★☆（**高**）
  - 任何拥有静态网站或开源项目的站长，贴一段 CDN 脚本即可立即获得漂亮的反馈浮层。
- **结论**：**极具社区实用价值的开源组件，排第 3**。

---

## 六、架构结论：一个仓库 vs N 个仓库的开源维护成本对比

在全量开源与多模块分发的策略下，**极不建议将代码物理拆分成多个独立的 Git 仓库**，理由从开源社区维护与工程协作角度对比如下：

| 维度 | 一个仓库 (Monorepo 统一开源) | 拆成 N 个仓库 (Polyrepo 分离维护) |
| :--- | :--- | :--- |
| **社区贡献与提 PR** | **体验极佳**：社区贡献者只需 `git clone` 一次，即可在本地运行全部示例、修复跨层 Bug 并提交单一 PR，无需在多个仓库间反复跳转。 | **门槛极高**：贡献者若想改一个接口协议，必须在 3 个仓库分别提 PR，本地还得用复杂的 `npm link` 进行联调，容易劝退外部贡献者。 |
| **Issue 与反馈集中度** | **集中管理**：全网用户统一在主仓库提 Issue 和 Discussion，维护者可以在一个看板下打标签归类（如 `area:mcp`、`area:widget`），不会遗漏。 | **信息碎片化**：Issue 分散在 N 个不同仓库中，用户常常提错地方；维护团队需要监控多个仓库通知，沟通成本倍增。 |
| **CI / CD 流水线** | **维护成本低**：一套统一的 GitHub Actions。借助 Turborepo 增量缓存，哪个子包改了只测哪个，共用全局测试工具和环境变量。 | **高昂内耗**：每个仓库都要维护一套独立的 Actions 工作流、Dependabot 配置与发布密钥，任何公共脚本变动要在 N 个仓库重复修改。 |
| **跨模块重构与类型安全** | **绝对安全**：内部包通过 `workspace:*` 互相引用。重构核心协议（如 `packages/types`）时，全仓 TypeScript 秒级报错，确保主干随时处于绿色可用状态。 | **隐蔽破坏**：底层包修改后若未经过全链路联调，下游包升级时极易出现运行时类型崩溃，且无法在一个 commit 中原子化修复。 |
| **开源分发灵活性** | **完全兼容独立分发**：Monorepo 完全支持使用 Changesets 分别向 npm 发布独立包、向 GitHub Releases 分别发布各自的 Release Tag 和资产包。 | 无额外分发优势，徒增工程隔离成本。 |

### 明确架构建议（一句话决策）

> **【明确建议】坚决保留单仓库（Monorepo）开源结构，绝不物理拆分 Git 仓库！通过 Turborepo + Changesets 建立独立的子模块发版流水线，统一集中处理 Issue 与 PR，同时将 `marklayer-mcp`（npm 发布）、`@marklayer/inspect-copy`（扩展 zip 发布）、`@marklayer/web-widget`（CDN 脚本发布）作为独立开源资产面向社区提供！**
