# 视觉协作 5 大插件说明书存在性核实与抽取可行性报告 (2026-11-11)

> **测试目的**：对 `C:\Users\xxc\d\web-review-plugins\plugins\` 下 5 份插件说明书（`01-mcp-annotations-bridge`、`02-inspect-copy`、`03-feedback-widget`、`04-visual-compare`、`05-standalone-annotate`）进行严格的代码级「存在性验证」，逐条比对主仓库实现，核查功能真实性、验收可执行性、解耦阻碍与实际工程工作量。

---

## 一、存在性核对总表

| 插件目录与名称 | 宣称功能数 | 真实实现情况 (✅完全有 / ⚠️部分或有偏差 / ❌完全没有) | 能否单抽独立 | 预估工作量 | 核心阻碍与现状定级 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **01 · `01-mcp-annotations-bridge`**<br>(MCP 批注桥) | 7 条 | ✅ 6 条<br>⚠️ 0 条<br>❌ 1 条 (断网自动恢复后续批注) | **能单抽**<br>(改一改) | **0.5 ~ 1 人天** | 已作为 `marklayer-mcp` 在 npm 发布，自包含性极好；唯独断网后不会自动重连，且必须依赖远端/本地 Worker 房间 WebSocket。 |
| **02 · `02-inspect-copy`**<br>(元素上下文提取) | 7 条 | ✅ 7 条<br>⚠️ 0 条<br>❌ 0 条 | **最容易单抽**<br>(直接抽) | **2 ~ 3 人天** | 100% 纯客户端本地运行，无任何后端、数据库与网络服务依赖，算法与单测完备，独立性最高。 |
| **03 · `03-feedback-widget`**<br>(访客反馈挂件) | 6 条 | ✅ 2 条<br>⚠️ 1 条 (展开仅 Pin 评论无画板)<br>❌ 3 条 (无马赛克/截图为 null/无 data-endpoint) | **不能直接单抽**<br>(需重度补写) | **4 ~ 6 人天** | 现有 `widget/` 代码为极简 stub 架构，截图函数直接 `return null`，无涂鸦工具，无 Webhook 管道，目前是半成品。 |
| **04 · `04-visual-compare`**<br>(双页视觉比对) | 5 条 | ✅ 1 条 (并排展示)<br>⚠️ 2 条 (滚动同步无法关闭/无尺寸对齐)<br>❌ 2 条 (非纯前端需反代/无半透明无截图兜底) | **不能纯前端单抽**<br>(需捆绑代理) | **3 ~ 4 人天** | 绝大多数外网网站自带 `X-Frame-Options: DENY`，强依赖 Worker 反代剥离头并注入滚动脚本，且叠加模式实际为卷帘滑块。 |
| **05 · `05-standalone-annotate`**<br>(独立标注扩展) | 6 条 | ✅ 3 条 (画图标注/Pin评论/本地保存)<br>⚠️ 2 条 (离线图层受限/缩放边缘漂移)<br>❌ 1 条 (根本没有长图与图片导出) | **能单抽**<br>(但需补齐长图) | **5 ~ 7 人天** | 标注与 IndexedDB 草稿成熟，但全仓**根本没有整页长截图或导出 PNG 的功能**（目前仅支持导出 Markdown 文档）。 |

---

## 二、逐个插件详细核验清单

---

### 1. `01-mcp-annotations-bridge` (MCP 批注桥)

#### 功能清单逐条核对
- **[✅] stdio 形态，`npx` 一行接入**  
  - **证据**：[`apps/mcp/package.json:23`](file:///D:/visual%20collaboration/apps/mcp/package.json#L23)（`"bin": { "marklayer-mcp": "dist/cli.js" }`），[`apps/mcp/src/cli.ts:1`](file:///D:/visual%20collaboration/apps/mcp/src/cli.ts#L1)，[`apps/mcp/src/server.ts:16`](file:///D:/visual%20collaboration/apps/mcp/src/server.ts#L16)（`StdioServerTransport`）。
  - **实情**：完全支持。通过 `bun run build` 即可生成零依赖单文件 `dist/cli.js`。
- **[✅] `watch_annotations` 轮询拿到新批注**  
  - **证据**：[`packages/agent-tools/src/tools.ts:376`](file:///D:/visual%20collaboration/packages/agent-tools/src/tools.ts#L376)（`marklayer_watch_annotations`）。
  - **实情**：支持。注意主仓工具名称带有 `marklayer_` 前缀。
- **[✅] `acknowledge` 认领批注，页面显示处理中**  
  - **证据**：[`packages/agent-tools/src/tools.ts:389`](file:///D:/visual%20collaboration/packages/agent-tools/src/tools.ts#L389)（`marklayer_acknowledge`），[`packages/agent-tools/src/room-core.ts:444`](file:///D:/visual%20collaboration/packages/agent-tools/src/room-core.ts#L444)。
  - **实情**：更新状态为 `in_progress` 并绑定 `agent_id`。
- **[✅] `resolve` 解决批注并附带总结**  
  - **证据**：[`packages/agent-tools/src/tools.ts:395`](file:///D:/visual%20collaboration/packages/agent-tools/src/tools.ts#L395)（`marklayer_resolve`），[`packages/agent-tools/src/room-core.ts:457`](file:///D:/visual%20collaboration/packages/agent-tools/src/room-core.ts#L457)。
  - **实情**：将批注置为 `resolved`，并将总结文本作为 reply 写入评论流。
- **[✅] `reply` 在批注下回话**  
  - **证据**：[`packages/agent-tools/src/tools.ts:406`](file:///D:/visual%20collaboration/packages/agent-tools/src/tools.ts#L406)（`marklayer_reply`）。
- **[✅] `read_page` 反向读取页面文本与控件**  
  - **证据**：[`packages/agent-tools/src/tools.ts:330`](file:///D:/visual%20collaboration/packages/agent-tools/src/tools.ts#L330)（`marklayer_read_page`）。
- **[✅] 携带结构化上下文（稳定选择器、盒模型、图层笔迹与形状）**  
  - **证据**：[`packages/types/src/ops.ts:87-109`](file:///D:/visual%20collaboration/packages/types/src/ops.ts#L87-L109)（`targetElementSchema`），[`apps/extension/lib/comment-context.ts:9-55`](file:///D:/visual%20collaboration/apps/extension/lib/comment-context.ts#L9-L55)（`commentContext` 打包图层笔迹与形状至 `visualContext`）。

#### 验收步骤真实性与前置
- **[⚠️] 1. 客户端列出 5 个工具**：当前代码实际注册了 10+ 个工具（含 `marklayer_list_annotations`、`marklayer_task`、`teach_*` 等），且工具名均带 `marklayer_` 前缀。需先跑 `apps/mcp/src/manifest.test.ts` 验证。
- **[✅] 2. 拿到批注及 selector 与 bounds**：字段名为 `target.selector` 和 `target.rect`（包含 x, y, width, height）。**前置**：必须连接一个存活的 WebSocket 房间。
- **[✅] 3. acknowledge 状态变处理中**：实测通过（参见 `acceptance/README.md:14`）。**前置**：同一房间内开启 Web Viewer。
- **[✅] 4. resolve 总结可见**：实测通过。
- **[❌] 5. 断网再恢复，服务不崩，能接着收到后续批注**：**描述不实**。代码证据 [`apps/mcp/src/room.ts:101-104, 163, 183-186`](file:///D:/visual%20collaboration/apps/mcp/src/room.ts#L101-L186)。断网后 socket 触发 `close` 会执行 `this.die(reason)` 锁死状态；后续调用直接报错返回 `room ... is not connected — call marklayer_connect_room to reconnect`。**服务进程本身不崩，但绝对不会自动重连并接着收，必须由客户端显式调用 connect 重新连接！**

#### 抽取可行性与工作量
- **依赖内部包**：`@marklayer/agent-tools`、`@marklayer/brand`、`@marklayer/types`。
- **外部服务**：必须有 WebSocket 房间服务（Worker + Durable Object）。
- **环境变量**：代码实为 `MARKLAYER_ROOM`、`MARKLAYER_API_BASE`、`MARKLAYER_AGENT`（[`apps/mcp/src/cli.ts:27-29`](file:///D:/visual%20collaboration/apps/mcp/src/cli.ts#L27-L29)），而非 README 声称的 `WEB_REVIEW_*`。
- **工作量**：**0.5 ~ 1 人天**。代码量仅约 380 行，已自包含，测试套件完备（`apps/mcp/src/*.test.ts` 20 项全绿）。

---

### 2. `02-inspect-copy` (元素上下文提取)

#### 功能清单逐条核对
- **[✅] 纯本地浏览器扩展**  
  - **证据**：[`apps/extension/`](file:///D:/visual%20collaboration/apps/extension)，全功能运行于 content script 内存中。
- **[✅] 鼠标划过高亮描边**  
  - **证据**：[`apps/extension/components/InspectorLayer.tsx:47-67`](file:///D:/visual%20collaboration/apps/extension/components/InspectorLayer.tsx#L47-L67)（`HoverHighlight`、`HoverTooltip`），[`apps/extension/lib/selector.ts:36`](file:///D:/visual%20collaboration/apps/extension/lib/selector.ts#L36)（`pickElementAtPoint`）。
- **[✅] 稳定选择器（过滤 Tailwind、抗动态重排）**  
  - **证据**：[`apps/extension/lib/selector.ts:105-250`](file:///D:/visual%20collaboration/apps/extension/lib/selector.ts#L105-L250)（`TW_KEYWORDS`、`TW_PREFIXES` 过滤，优先 `data-testid` 等稳定属性）。
- **[✅] 盒模型与计算样式（尺寸、间距、字号、颜色、flex/grid）**  
  - **证据**：[`apps/extension/lib/element-details.ts:22-140`](file:///D:/visual%20collaboration/apps/extension/lib/element-details.ts#L22-L140)（`captureElementDetails`）。
- **[✅] 父级布局判定**  
  - **证据**：[`apps/extension/lib/element-details.ts:106-135`](file:///D:/visual%20collaboration/apps/extension/lib/element-details.ts#L106-L135)（`captureParentContext`）。
- **[✅] 框架信息识别（React/Vue/Preact 等组件名）**  
  - **证据**：[`apps/extension/lib/fiber-bridge.ts:24-95`](file:///D:/visual%20collaboration/apps/extension/lib/fiber-bridge.ts#L24-L95)（`detectFrameworkComponent`，探针深入 `__reactFiber$` 与 `__vueParentComponent`）。
- **[✅] 一键复制 AI 友好 Markdown**  
  - **证据**：[`apps/extension/lib/inspect-note.ts:10-55`](file:///D:/visual%20collaboration/apps/extension/lib/inspect-note.ts#L10-L55)（`buildInspectPrompt`），[`apps/extension/lib/toasts.ts:32`](file:///D:/visual%20collaboration/apps/extension/lib/toasts.ts#L32)（`copyText`）。

#### 验收步骤真实性与前置
- **[✅] 1. 任意复杂页面选中元素**：实测通过。**前置**：编译扩展 `cd apps/extension && bun run build`。
- **[✅] 2. 复制出 Markdown 且选择器唯一命中**：实测通过（`apps/extension/lib/selector.test.ts:15-180` 覆盖验证）。
- **[✅] 3. 刷新后选择器不变**：纯纯静态 DOM 遍历算法，确定性极高。
- **[✅] 4. 断网状态照常可用**：无任何网络交互，剪贴板 API 纯本地运行。

#### 抽取可行性与工作量
- **依赖内部包**：`@marklayer/types`（仅抽 `TargetElement` 类型约 30 行），`@marklayer/ui`（抽 `cn` 函数）。
- **外部服务**：**零外部服务**，无需后端支持。
- **环境变量**：**零环境变量**。
- **工作量**：**2 ~ 3 人天**。代码集中在 8 个文件约 1200 行，独立性极强。

---

### 3. `03-feedback-widget` (访客反馈挂件)

#### 功能清单逐条核对
- **[✅] 一行脚本嵌入任何站点**  
  - **证据**：[`apps/extension/widget/loader.ts:1-25`](file:///D:/visual%20collaboration/apps/extension/widget/loader.ts#L1-L25)（`widget.js`）。
- **[⚠️] 访客点气泡进入涂鸦画布**  
  - **实情**：气泡存在，但进入的不是涂鸦画布！[`apps/extension/widget/WidgetApp.tsx:30-34`](file:///D:/visual%20collaboration/apps/extension/widget/WidgetApp.tsx#L30-L34) **只挂载了 `<CommentLayer />`（Pin 评论与留言），根本没有挂载 `<Canvas />` 画板**。
- **[❌] 截图 + 涂鸦（矩形、箭头、画笔、马赛克）**  
  - **真相 1（无马赛克）**：全仓搜索 `mosaic`、`blur`，代码中没有任何马赛克工具。
  - **真相 2（无截屏）**：[`apps/extension/widget/lite/ScreenCapture.tsx:1`](file:///D:/visual%20collaboration/apps/extension/widget/lite/ScreenCapture.tsx#L1) 源码为：`export function ScreenCapture() { return null; }`，为了缩减挂件体积，截屏被完全桩化（stub）移除！
  - **真相 3（无涂鸦）**：挂件模式未集成画笔、矩形、箭头组件。
- **[✅] 留言说明**  
  - **证据**：`CommentLayer` 支持输入说明文字。
- **[✅] 自动带上环境（URL、分辨率、选择器）**  
  - **证据**：[`apps/extension/lib/selector.ts:82`](file:///D:/visual%20collaboration/apps/extension/lib/selector.ts#L82)（`captureTarget`）。
- **[❌] 提交至自定义接收端（`data-endpoint` / 自定义表单 / Webhook）**  
  - **真相**：[`apps/extension/widget/loader.ts:19`](file:///D:/visual%20collaboration/apps/extension/widget/loader.ts#L19) 只认 `data-room` 和 `data-project`；[`apps/extension/widget/app.tsx:36`](file:///D:/visual%20collaboration/apps/extension/widget/app.tsx#L36) 写死调用 `joinRoom({ id: roomId })` 接入 MarkLayer Worker 后端。**根本没有 `data-endpoint` 属性，也无法提交到自定义 Webhook！**

#### 验收步骤真实性与前置
- **[❌] 1. 点气泡进入涂鸦状态**：只能落 Pin 留文字，无法涂鸦。
- **[❌] 2. 圈区域并提交至 `data-endpoint`**：圈选涂鸦和自定义 endpoint 均不存在。
- **[❌] 3. 手机浏览器正常涂鸦**：无移动端 touch 涂鸦逻辑。
- **[✅] 4. 未激活时不影响页面点击和滚动**：`pointer-events` 与 Shadow DOM 隔离良好。

#### 抽取可行性与工作量
- **现状定级**：**半成品**。
- **独立抽取要求**：必须重写上报管道（增加 Webhook POST 发送器），并将主扩展中的轻量画板真正迁移过来。
- **工作量**：**4 ~ 6 人天**。

---

### 4. `04-visual-compare` (双页视觉比对)

#### 功能清单逐条核对
- **[❌] 纯前端的比对工具**  
  - **真相**：不是纯前端。[`apps/worker/web/compare/Compare.tsx:68`](file:///D:/visual%20collaboration/apps/worker/web/compare/Compare.tsx#L68) 调用 `src={frameSrc({ url })}`，经由 Worker `/proxy?url=...` 后端代理发起抓取并剥离 `X-Frame-Options` 和 CSP。如果没有后端代理，现代站点作为 iframe 会直接被浏览器安全策略封死。
- **[⚠️] 并排（左右视口，滚动一致或各自独立）**  
  - **真相**：`SideBySide` 存在（[`Compare.tsx:85-102`](file:///D:/visual%20collaboration/apps/worker/web/compare/Compare.tsx#L85-L102)），滚动同步存在；但**“各自独立 / 关掉同步”不存在**，代码中滚动监听是硬编码常驻的，没有关闭开关。
- **[❌] 叠加（两张画面半透明叠在一起）**  
  - **真相**：[`Compare.tsx:107-163`](file:///D:/visual%20collaboration/apps/worker/web/compare/Compare.tsx#L107-L163)（`SliderOverlay`）实现的是 **卷帘滑块**（通过 `clipPath: inset(0 0 0 ${split.value}%)` 左右滑动对比），**根本不是半透明（opacity）叠加**！
- **[⚠️] 滚动同步（可锁定某一侧）**  
  - **真相**：两边等比同步滚动（`ml-scroll-sync`），**没有“锁定某一侧”** 的能力。
- **[⚠️] 尺寸对齐（按同一视口宽度渲染）**  
  - **真相**：使用 `grid-cols-2` 均分容器宽度，没有针对两边强制模拟独立自定义分辨率（如 1440px / 375px）的机制。
- **[❌] 目标站点不允许 iframe 时退化成截图比对**  
  - **真相**：代码里没有任何截图对比的退化 fallback，iframe 加载失败直接显示空白或浏览器安全拦截页。

#### 验收步骤真实性与前置
- **[⚠️] 1. 输入两个地址两边渲染出来**：仅当启动本地 Worker 开发服务且经过反代时生效。**前置**：必须运行 `bunx wrangler dev --local`。
- **[❌] 2. 关掉同步后互不影响**：UI 上没有关掉同步的控制项。
- **[⚠️] 3. 叠加模式看到错位**：能看到卷帘滑块裁切对比，非半透明。
- **[✅] 4. 改视口宽度两边一起变**：响应式 CSS 正常工作。

#### 抽取可行性与工作量
- **依赖内部包**：`@ext/lib/buttons`、`@ext/lib/geist`、`@marklayer/brand/links`、`@marklayer/ui/cn`。
- **外部服务**：必须捆绑一个轻量级代理服务（如 3KB 的 Hono/Node 代理）剥离安全头。
- **工作量**：**3 ~ 4 人天**（含抽取独立代理服务）。

---

### 5. `05-standalone-annotate` (独立标注扩展)

#### 功能清单逐条核对
- **[✅] 装上就能用，不连服务器**  
  - **证据**：`apps/extension/`，草稿保存在 IndexedDB，未分享时不会主动上传服务器。
- **[✅] 画笔、荧光笔、橡皮、矩形、箭头、文字、文字选中高亮**  
  - **证据**：`Canvas.tsx`（画笔/高亮/橡皮）、`ops.ts:rectOpSchema`（矩形）、`arrow-head.ts`（箭头）、`TextLayer.tsx`（文字）、`SelectionLayer.tsx`（高亮）。
- **[✅] Pin 评论（钉留言、可回复、改状态）**  
  - **证据**：`CommentLayer.tsx`、`CommentPin.tsx`、`PriorityMenu.tsx`。
- **[⚠️] 图层（多套标注分开画，随时切换显示）**  
  - **实情**：图层切换（`layerChoices`）与显示隐藏已实现；但图层创建 [`apps/extension/components/LayerPanel.tsx:25`](file:///D:/visual%20collaboration/apps/extension/components/LayerPanel.tsx#L25) 依赖向 WebSocket 发送 `layer_create`。在纯单机离线状态下，**新建图层无法保存**，只能停留在“默认图层”。
- **[❌] 导出：整页长图（含所有标注），或只导某一层**  
  - **真相**：**全仓根本不存在导出长图（Long screenshot stitcher）或导出 PNG 的功能！**
  - **代码证据**：全局搜索 `.download =`，唯一出现的位置在 [`apps/extension/lib/export-text.ts:179`](file:///D:/visual%20collaboration/apps/extension/lib/export-text.ts#L179)，导出的格式是 **Markdown 文档 (`.md`)**，不是图片。截图逻辑仅在 `capture.ts:57` 用于给单条评论截当前视口小图，无法导出全页长图。
- **[✅] 本地保存（刷新页面标注还在，存本机不上传）**  
  - **证据**：[`apps/extension/lib/draft.ts`](file:///D:/visual%20collaboration/apps/extension/lib/draft.ts)，基于 `idb-keyval` 将当前页面 URL 关联的所有 `operations` 持久化，页面刷新后完整反序列化复原。

#### 验收步骤真实性与前置
- **[✅] 1. 画矩形和箭头，刷新还在原位**：实测通过。
- **[⚠️] 2. 浏览器缩放 100%/125% 落点跟手不偏**：部分实现。针对宿主 CSS `zoom` 做了逆补偿，但浏览器原生缩放（Ctrl++）在视口边界依然有漂移未闭环（参见 `docs/visual-collaboration-progress.md:11`）。
- **[✅] 3. 新建两条 Pin 评论，能回复改状态**：实测通过。
- **[❌] 4. 导出长图并保存图片到本地**：**完全做不到，没有对应代码实现**。
- **[✅] 5. 断网全部照常**：除分享和新建图层外，基础标注与 Pin 离线均可用。

#### 抽取可行性与工作量
- **依赖内部包**：`@marklayer/types`、`@marklayer/agent-tools`、`@marklayer/brand`、`@marklayer/tokens`、`@marklayer/ui`。
- **外部服务**：单机模式无需外部服务，但必须从 UI 上剥离“创建分享房间”和“WebRTC 音视频”等云端协同依赖。
- **工作量**：**5 ~ 7 人天**。代码量庞大（231 个文件），且若要实现 README 承诺的“整页长图拼接导出”，需要额外编写滚动拼接 Canvas 引擎。

---

## 三、「README 需要改的说法」清单

为确保开源说明书实事求是、不误导社区贡献者，以下内容必须按主仓库实情修正：

| 插件 | 当前 README 夸大或不实说法 | 修正建议（主仓库真相） |
| :--- | :--- | :--- |
| **01 · MCP 批注桥** | 1. 宣称环境变量为 `WEB_REVIEW_ROOM_URL`、`WEB_REVIEW_AGENT_ID`。<br>2. 验收第 5 条称“断网再恢复，服务不崩，能接着收到后续批注”。 | 1. 改为实际代码环境变量 `MARKLAYER_ROOM`、`MARKLAYER_AGENT`、`MARKLAYER_API_BASE`。<br>2. 说明断网后服务进程保持存活，但**不会自动重连**，必须调用 `marklayer_connect_room` 重新连入。 |
| **02 · 元素审查** | 无明显虚标，各项功能均有代码支撑。 | 补充说明：一键复制支持快捷键与多种框架探测（React Fiber、Vue 等）。 |
| **03 · 访客反馈挂件** | 1. 宣称支持“截图 + 涂鸦（矩形、箭头、画笔、马赛克）”。<br>2. 宣称支持 `data-endpoint` 自定义 Webhook 提交。<br>3. 宣称手机端正常涂鸦。 | 1. **全删**！明确注明当前挂件为 **Pin 留言模式**，无马赛克，无画笔涂鸦，截屏功能当前处于关闭状态（`return null`）。<br>2. 明确说明当前仅支持 `data-room` / `data-project` 连入 MarkLayer 云端协同，**尚未支持自定义 Webhook**。<br>3. 状态标明为：`原型阶段/半成品`。 |
| **04 · 双页比对** | 1. 宣称是“纯前端的比对工具”。<br>2. 宣称“叠加：两张画面半透明叠在一起”。<br>3. 宣称“滚动同步可关掉 / 锁定某一侧”。<br>4. 宣称“目标站点不允许 iframe 时退化成截图比对”。 | 1. 明确声明**必须搭配后端反向代理服务**，否则受同源策略和 `X-Frame-Options` 限制无法加载外网网址。<br>2. 将“半透明叠加”更正为**“卷帘滑块（Slider Curtain）对比”**。<br>3. 删掉“锁定某一侧”与“关掉同步”，说明当前为强制双向等比同步。<br>4. 删掉“截图比对兜底”。 |
| **05 · 独立标注** | 1. 宣称“导出：整页长图（含所有标注），或只导某一层”。<br>2. 宣称“图层随时切换分开画”。 | 1. **删掉长图导出描述**！实事求是写明：当前仅支持**导出 Markdown 格式清单 (`.md`)**，不支持生成或下载标注长图片。<br>2. 补充说明：纯单机离线状态下仅支持单图层，多图层创建需要协同房间支持。 |

---

## 四、建议的抽取顺序与第一步文件级操作

按 **「可用度最高、依赖最纯粹、改造工作量最小」** 的原则排序：

```
[第 1 顺位] 02-inspect-copy       ──► 纯客户端, 零后端依赖, 2-3天即可完美闭环
[第 2 顺位] 01-mcp-annotations   ──► 核心文件仅3个, 0.5-1天打包成自包含 npm 包
[第 3 顺位] 04-visual-compare     ──► 前端改卷帘说法, 连同微型反代脚本一起抽出
[第 4 顺位] 05-standalone-annotate──► 标注体验完整, 砍掉长图幻想或补写长截图
[第 5 顺位] 03-feedback-widget   ──► 严重缺实现, 需重新研发 Webhook 接收端与画板
```

### 第一个该动手的文件级步骤（从 `02-inspect-copy` 开始）：

1. **新建目标工程目录**：在插件仓库初始化独立 WXT 项目（`apps/inspect-copy` 或独立根目录）。
2. **复制核心算法与界面文件**：
   - 算法层：直接拷贝主仓的 [`apps/extension/lib/selector.ts`](file:///D:/visual%20collaboration/apps/extension/lib/selector.ts)、[`element-details.ts`](file:///D:/visual%20collaboration/apps/extension/lib/element-details.ts)、[`fiber-bridge.ts`](file:///D:/visual%20collaboration/apps/extension/lib/fiber-bridge.ts)、[`inspect-note.ts`](file:///D:/visual%20collaboration/apps/extension/lib/inspect-note.ts)。
   - 组件层：拷贝 [`apps/extension/components/InspectorLayer.tsx`](file:///D:/visual%20collaboration/apps/extension/components/InspectorLayer.tsx)、[`HoverTooltip.tsx`](file:///D:/visual%20collaboration/apps/extension/components/HoverTooltip.tsx)、[`CssEditor.tsx`](file:///D:/visual%20collaboration/apps/extension/components/CssEditor.tsx)。
3. **断绝外部依赖（3 处修改）**：
   - 新建本地 `types.ts`，拷贝主仓 `packages/types/src/ops.ts` 中的 `TargetElement` 和 `ElementDetails` 声明（约 35 行），断开 `@marklayer/types` 引用。
   - 新建本地 `cn.ts`，内联简单的 `clsx` + `twMerge`，断开 `@marklayer/ui` 引用。
   - 注释或删除 `InspectorLayer.tsx` 中对 `pushOp`（协同画板）和 `connectionStatus`（网络状态）的调用，将复制事件直接绑定到本地原生 `navigator.clipboard.writeText`。
4. **运行已有测试验证**：将主仓的 [`apps/extension/lib/selector.test.ts`](file:///D:/visual%20collaboration/apps/extension/lib/selector.test.ts) 移入新工程执行 `bun test`，测试通过即告抽离成功。
