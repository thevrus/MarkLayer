# 人机视觉协作六阶段代码差距审计报告 (2026-11-11)

本报告基于当前仓库代码与验收记录，对照 `docs/visual-collaboration-progress.md` 规划的六个实施阶段，对全部 18 个条目进行逐项代码审计与状态判断。

---

## 一、仓库实际代码目录概览

- **`apps/extension`**：Chrome 扩展端代码。包括标注画板（Canvas）、评论与空间上下文提取（CommentLayer/comment-context）、取样范围调节（pin-shot/AttachmentPicker）、DOM 选择器（selector）、锚点重定位（anchor）、工具栏（Toolbar）与截屏（capture）。
- **`apps/worker`**：Cloudflare Worker 后端及网页端 Web Viewer。包含 Durable Object 协同房间（annotation-room）、执行模式存储与迁移（store/migrations）、教学演示层（TeachLayer/viewer-state）及 MCP 路由（mcp）。
- **`apps/mcp`**：独立 MCP 服务端实现及本地房间测试套件。
- **`apps/site`**：Astro 静态文档与宣传站点。
- **`packages/agent-tools`**：AI Agent 交互协议与工具定义（marklayer_read_page、teach_step、teach_start、marklayer_watch_annotations 等）。
- **`packages/types`**：前后端与 MCP 共享的数据结构、Wire 协议与绘图 Op 定义（DrawOp、CommentOp、TargetElement 等）。
- **`packages/ui` / `packages/brand`**：基础组件与品牌资产。
- **`acceptance`**：本地多会话真实/模拟验收记录与截图证据。

---

## 二、六阶段逐条审计清单

### 阶段一：基线与缩放

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 1.1 | 完整核对 Comment、图层、截图、锚点和三种模式的实现及真实验收 | **部分完成** | [`packages/types/src/wire.ts:94`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/packages/types/src/wire.ts#L94) | 代码层面已完整实现 Comment、图层、截图取样、锚点以及 solo/guide/pair 三种模式协议与单测，并在 [`acceptance/README.md:14`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/README.md#L14) 完成本地双会话交互验证；但受限于真实浏览器 CDP 交互授权，端到端真实验收未完全闭环。 |
| 1.2 | 实测项目内缩放、浏览器缩放、窗口尺寸、滚动和高分屏坐标 | **部分完成** | [`apps/worker/web/zoomScale.ts:16`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/zoomScale.ts#L16) | 项目内 Viewer 缩放刻度（zoomScale）与画布共享变换（[`apps/worker/web/viewer-state.ts:91`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/viewer-state.ts#L91)）已实现并有单元测试，视口尺寸自适应已测；但真实浏览器原生缩放（browser zoom）、物理高分屏（真实 DPR 设备）及滚动后坐标锁定尚未完成真机验收。 |
| 1.3 | 验证浏览器缩放时原位置只读及恢复条件；不能可靠判断时提示 | **没做** | [`apps/extension/lib/overlay-mount.ts:48`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/overlay-mount.ts#L48) | 当前代码仅对宿主 HTML 样式的 CSS `zoom` 做了逆变换补偿（`unzoom`），并未实现浏览器缩放检测、只读策略锁定机制、Ctrl+0 恢复判断及不可靠时的用户提示。 |

---

### 阶段二：Comment 视觉上下文

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 2.1 | 精确十字光标和点击中心、可调取样范围 | **部分完成** | [`apps/extension/lib/pin-shot.ts:20`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/pin-shot.ts#L20) | 十字光标（[`apps/extension/components/CommentLayer.tsx:74`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentLayer.tsx#L74)）、点击中心偏移计算与 100~1600px 可调取样范围滑块（`setPinShotDimension`）均已实现且通过单测；但尚未完成结合真实 AI 识图的真实有效性验收。 |
| 2.2 | 工具栏菜单和中央虚线框，验证边缘、超出视口与设备像素比 | **部分完成** | [`apps/extension/components/Toolbar.tsx:203`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/Toolbar.tsx#L203) | 工具栏调节菜单及视口居中虚线预览框（`border-dashed border-blue-500`）已实现并限制最大 95vw/95vh；但边缘平移自适应裁切、超出视口边界行为与跨设备像素比实测仍缺乏完整测试覆盖。 |
| 2.3 | 真实截图包含 UI、放大预览及截图与当前图层批注一并传递给 AI | **部分完成** | [`apps/extension/lib/capture.ts:56`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/capture.ts#L56) | 扩展截屏已取消隐藏标注层（`shootViewport` 保留 UI），撰写评论时支持图片放大预览（[`apps/extension/components/AttachmentPicker.tsx:314`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/AttachmentPicker.tsx#L314)），且提取当前图层笔迹与批注的空间上下文生成逻辑已完成（[`apps/extension/lib/comment-context.ts:9`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/comment-context.ts#L9)）；但网页 Viewer 截屏路径仍不含工具栏，且真实 AI 读取附图的闭环未验收。 |

---

### 阶段三：按需元素读取与备用锚点

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 3.1 | 按需、分批读取当前视口可访问的页面元素 | **没做** | [`apps/extension/lib/selector.ts:31`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/selector.ts#L31) | 现有代码仅有单点光标拾取元素（`pickElement`）和整页静态 HTML 轮廓提取（[`apps/worker/src/mcp.ts:27`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/src/mcp.ts#L27)），没有视口内可见元素分批次扫描、过滤与按需读取的协议与实现。 |
| 3.2 | 为 Comment 保留可用 DOM 线索，并确认其不改变用户选定的定位策略 | **部分完成** | [`apps/extension/lib/anchor.ts:18`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/anchor.ts#L18) | 在落 Pin 时已捕获目标 DOM 元素的 selector、tag、rect 及文本指纹，并支持 primary / text / page 策略在重排后自适应（[`apps/extension/components/CommentLayer.tsx:87`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentLayer.tsx#L87)）；但尚未提供让用户主动指定/锁定定位策略（固定坐标 vs 相对DOM）的显式交互与保全确认机制。 |
| 3.3 | 检查图片、PDF、Canvas、跨源 iframe 和旧房间兼容性 | **部分完成** | [`apps/worker/web/pdf-render.ts:122`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/pdf-render.ts#L122) | PDF 基础渲染与 Canvas 批注、旧房间 D1 数据库 0014 迁移脚本均已存在，且在 PDF 锚点处已标明上下文不完整（[`apps/extension/lib/comment-context.ts:20`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/comment-context.ts#L20)）；但跨源 iframe 深度通信、Canvas 内部图形元素识别及全面兼容性专项测试套件尚未建立。 |

---

### 阶段四：Pair 与 Guide

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 4.1 | Pair 通过用户实际目标操作推进，支持手动下一步 | **已完成** | [`apps/worker/web/TeachLayer.tsx:99`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L99) | 网页端演示面板已实现并提供“下一步”按钮交互，分发 `teach_control` 的 `next` 动作并同步状态；在 [`acceptance/README.md:16`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/README.md#L16) 中已通过双会话实测人类点击与 MCP 监听联动。 |
| 4.2 | Guide 不等待用户操作，自动演示并支持暂停、继续、结束 | **部分完成** | [`apps/worker/web/TeachLayer.tsx:41`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L41) | 演示控制支持暂停（pause）、继续（resume）、关闭结束（[`apps/worker/web/TeachLayer.tsx:99`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L99)），协议与界面均已贯通；但前端尚未内置免人工交互的自动步进定时轮播器（auto-play interval），目前全由人工或外部逐步驱动。 |
| 4.3 | 使用真实 AI 和浏览器验证两步以上、误点、断连及完成状态 | **部分完成** | [`acceptance/layers-ai-2026-11-10.md:10`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/layers-ai-2026-11-10.md#L10) | 本地验收记录明确记录了局限性：现有本地验收采用模拟 AI 客户端，尚未在真实浏览器环境中由独立真实 AI 客户端完成两步以上演示、误点防护、网络断连及完成状态的全闭环验收。 |

---

### 阶段五：性能与隐私研究

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 5.1 | 测量普通、复杂与长页面的扫描、截图和演示开销 | **没做** | [`apps/extension/lib/capture.ts:57`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/lib/capture.ts#L57) | 仓库内仅有基础的 `shootViewport` 与 `pinCrop` 函数，完全缺乏针对普通、复杂与长页面的扫描/截图/演示性能基准测量测试、计时打点或开销对比报告。 |
| 5.2 | 比较本地文本规则与候选模型，单独研究图片敏感信息处理 | **没做** | [`apps/worker/src/posthog.ts:5`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/src/posthog.ts#L5) | 代码中仅包含服务端 PostHog 日志中 URL 正则脱敏逻辑，不存在针对截图敏感信息的脱敏处理算法（OCR/遮蔽），也未建立本地文本规则与候选视觉模型的对比研究。 |
| 5.3 | 用实测决定是否集成，不预设模型 | **没做** | [`packages/agent-tools/src/tools.ts:319`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/packages/agent-tools/src/tools.ts#L319) | 仓库目前保持协议中立，尚未开展基于实测数据驱动的模型选型对比与集成决策工作。 |

---

### 阶段六：端到端验收与说明

| 序号 | 规划条目 | 判断 | 代码证据 (文件:行号) | 现状与差距说明 |
| :--- | :--- | :---: | :--- | :--- |
| 6.1 | 真实房间完成 Comment 到 AI 读取和回应的完整链路 | **部分完成** | [`acceptance/layers-ai-2026-11-10.md:6`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/layers-ai-2026-11-10.md#L6) | 网页生成带评论与图层的任务已可被模拟/辅助 AI 通过 MCP 接口领取与流转，数据通路已通；但带有真实截图的 Comment 被真实视觉 AI 完整读取、理解并直接在浏览器中响应的端到端验收尚未完成（[`acceptance/layers-ai-2026-11-10.md:10`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/layers-ai-2026-11-10.md#L10)）。 |
| 6.2 | 验证缩放、旧房间、多人、同名 AI、刷新和断线恢复 | **部分完成** | [`acceptance/layers-ai-2026-11-10.md:8`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/acceptance/layers-ai-2026-11-10.md#L8) | 多人协同、同名 AI 认领冲突与优先级流转、进程异常退出重连以及旧房间迁移均有验证覆盖；但真实物理显示器高分屏、浏览器放大导致的批注偏移恢复仍未通过验收。 |
| 6.3 | 更新 README 与许可归属，按阶段提交并记录未覆盖的边界 | **部分完成** | [`FORK-NOTES.md:4`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/FORK-NOTES.md#L4) | 派生版本与 Apache-2.0 原许可保留说明已记录于 `FORK-NOTES.md`，并在验收文档中记录了阶段边界；但根目录主文档 [`README.md:7`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/README.md#L7) 仍为上游原始描述，未同步更新人机视觉协作方案、新功能架构与许可归属说明。 |

---

## 三、审计结果统计

- **已完成 (1 项)**：4.1
- **部分完成 (12 项)**：1.1, 1.2, 2.1, 2.2, 2.3, 3.2, 3.3, 4.2, 4.3, 6.1, 6.2, 6.3
- **没做 (5 项)**：1.3, 3.1, 5.1, 5.2, 5.3
- **总计**：18 项

---

## 四、核心结论与差距摘要

1. **核心逻辑完成度高**：Comment 截图范围调节、多图层空间上下文打包传递、Pair/Guide 演示协议与 MCP 交互通道已基本成型并通过单元测试。
2. **真实验收环境阻塞**：大量标记为“部分完成”的条目主要卡在真实浏览器 CDP 交互、真实视觉 AI 识图端到端运行环节，依赖外部环境就绪才能闭环。
3. **未开工盲区集中**：浏览器缩放只读锁定策略（1.3）、视口可见元素按需分批扫描（3.1）以及阶段五整套性能开销评测与图片敏感隐私处理（5.1~5.3）在代码库中完全空白，属于后续需要重点补齐的功能模块。
