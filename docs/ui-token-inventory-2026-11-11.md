# UI Token 取证式拆解与资产清单 (2026-11-11)

本报告对当前仓库核心设计资产（`packages/tokens/theme.css`、`apps/worker/web/style.css`、`apps/extension/entrypoints/content/style.css`、`apps/site/src/styles/global.css`、`packages/ui` 以及各前端组件与辅助类库）进行全量只读取证与静态拆解。

---

## 一、颜色体系与深浅色映射

### 1.1 核心颜色资产分组与色值表

系统颜色架构由三套来源层叠构成：
1. **`--color-ml-*`**（共享表面与语义色，源自 `packages/tokens/theme.css`，在 Web/Extension 中提供深色重载）；
2. **`--ds-*`**（Geist 设计系统色阶，控制黑白极性、灰阶和原生控件）；
3. **`--ml-state-*`**（OKLCH 语义状态色）；
4. **Site 独立色标**（Marketing 站点专用的单色墨水阶梯）。

| 分组 | 变量名 / 标识 | 浅色值 (Light) | 深色值 (Dark) | 核心用途与组件 |
| :--- | :--- | :--- | :--- | :--- |
| **主背景** | `--color-ml-bg` | `#fbfaf9` (应用底色) / `#ffffff` (文档/落地页) | `#111110` (暖黑) | 页面整体底色（`apps/worker/web/style.css:211`） |
| **主背景** | `--ds-background-100` | `#ffffff` | `#000000` | Geist 控件与面板底色（`apps/extension/lib/geist.ts:30`） |
| **次级背景** | `--color-ml-bg-viewer` | `#f5f5f5` | `#1a1a1a` | Web Viewer 画布底层（`apps/worker/web/style.css:212`） |
| **次级背景** | `--color-ml-bg-device` | `#e5e5e5` | `#0e0e0e` | 移动端设备外框背景（`apps/worker/web/style.css:213`） |
| **次级背景** | `--ds-gray-100` | `#f2f2f2` | `#1a1a1a` | 控件悬浮底色、禁用态背景 |
| **次级背景** | `--color-sunken` (site) | `#f5f5f5` | — | 行内代码块、下沉式区块背景（`apps/site/src/styles/global.css:93`） |
| **主前景/文字** | `--color-ml-fg` / `--color-ink` | `#1a1a1a` (tokens) / `#171717` (site/web) | `#e8e5e0` | 主正文、标题墨水色（Geist Text Primary 17.4:1 对比度） |
| **主前景/文字** | `--ds-gray-1000` | `#171717` | `#ededed` | 控件内主文字、图标前景色（`apps/extension/lib/geist.ts:46`） |
| **次级文字** | `--ds-gray-900` | `#4d4d4d` | `#a0a0a0` | 控件静置态文字、副标题、标签（`apps/extension/lib/geist.ts:51`） |
| **辅助文字** | `--ds-gray-700` | `#8f8f8f` | `#8f8f8f` | 输入框 placeholder、边框聚焦过渡色、已忽略状态 |
| **元数据/弱文字** | `--color-meta` (site) | `#6a6a6a` | — | 署名、时间戳、面包屑、次要元信息（`apps/site/src/styles/global.css:112`） |
| **弱化/列表标记** | `--color-faint` (site) | `#767676` | — | 列表数字、行图标、静置下划线（4.54:1 AA 阈值） |
| **强调/品牌色** | `--color-ml-accent` | `oklch(0.65 0.15 300)` | `oklch(0.78 0.13 300)` | 聚焦外框、主提交按钮高亮、光标（`packages/tokens/theme.css:39`） |
| **强调前景色** | `--color-ml-accent-fg` | `oklch(0.86 0.08 300)` | `oklch(0.86 0.08 300)` | 强调色徽章内的计数文字（固定不随主题翻转） |
| **品牌紫标 (Site)** | `--color-brand` | `#a855f7` | — | 站点 Logo 与品牌渐变起点（`apps/site/src/styles/global.css:128`） |
| **品牌深紫 (Site)**| `--color-brand-deep`| `#6d28d9` | — | 站点品牌渐变终点（`apps/site/src/styles/global.css:129`） |
| **中性已解决** | `--color-ml-resolved` | `oklch(0.55 0 0)` | `oklch(0.65 0 0)` | 已完成/已解决状态芯片、弱化样本色块 |
| **毛玻璃前景色** | `--color-ml-glass-fg` | `#000000` | `#ffffff` | 工具栏与毛玻璃面板文字前景色 |
| **毛玻璃交互高亮**| `--color-ml-glass-accent`| `oklch(0 0 0 / 0.06)` | `oklch(1 0 0 / 0.12)` | 面板内悬浮浅底 |
| **毛玻璃静置底色**| `--color-ml-glass-muted` | `oklch(0 0 0 / 0.03)` | `oklch(1 0 0 / 0.06)` | 面板内弱化背景 |
| **透明灰阶 100** | `--ds-gray-alpha-100` | `#0000000d` (5%) | `#ffffff0f` (6%) | 控件 Hover 底色（`apps/extension/lib/geist.ts:52`） |
| **透明灰阶 200** | `--ds-gray-alpha-200` | `#00000015` (8%) | `#ffffff17` (9%) | 控件 Active/Press 底色、快捷键徽章底色 |
| **透明灰阶 400** | `--ds-gray-alpha-400` | `#00000014` (8%) | `#ffffff24` (14%) | 输入框边框、分割线、菜单边框（`apps/extension/lib/geist.ts:120`）|
| **透明灰阶 500** | `--ds-gray-alpha-500` | `#00000036` (21%) | `#ffffff3d` (24%) | 强调性边框、外层环线 |
| **语义：成功/在线**| `--color-ml-live` / `--color-live` | `#0a7d33` (`--ds-green-900`) | `#0a7d33` | 页脚在线状态绿点、Approved 状态（4.82:1 对比度） |
| **语义：通过/成功**| `--ds-green-700` | `#28a948` | `#00ab3e` | Resolved 状态图标与徽章（`apps/extension/lib/status-ui.ts:57`） |
| **语义：批准/终态**| `--ds-green-900` | `#0a7d33` | `#00c853` | Approved 签署状态徽章（深一步的确认绿） |
| **语义：警告/进行**| `--ds-amber-700` | `#ffb200` | `#ffb200` | In Progress 状态指示点与警告图标 |
| **语义：错误/危险**| `--ds-red-700` | `#fc0035` | `#f13242` | 危险操作文字、删除按钮 Hover、报错提示 |
| **语义：信息/焦点**| `--ds-blue-800` | `#005edc` | `#005fd8` | Open 状态指示点、链接强调 |
| **语义：焦点高亮** | `--ds-focus-color` | `#0070f7` | `#50a8ff` | 键盘焦点环 `outline-(--ds-focus-color)` |
| **OKLCH状态色** | `--ml-state-blue` | `oklch(0.62 0.18 250)` | `oklch(0.72 0.17 250)` | 动态状态信息栏/标签蓝 |
| **OKLCH状态色** | `--ml-state-green` | `oklch(0.62 0.17 145)` | `oklch(0.78 0.18 145)` | 动态状态成功栏/标签绿 |
| **OKLCH状态色** | `--ml-state-red` | `oklch(0.62 0.22 25)` | `oklch(0.7 0.2 25)` | 动态状态错误栏/标签红 |
| **OKLCH状态色** | `--ml-state-yellow` | `oklch(0.78 0.16 85)` | `oklch(0.85 0.17 85)` | 动态状态警告栏/标签黄 |
| **OKLCH状态色** | `--ml-state-accent` | `oklch(0.65 0.15 300)` | `oklch(0.78 0.13 300)` | 动态状态品牌强调色 |

---

### 1.2 颜色定义不一致取证（同一用途多重色值）

取证发现，同一视觉意图在跨 Package / 组件时出现了严重的分裂现象：

1. **主前景色/墨水黑的分裂（3 种不同色值）**：
   - `packages/tokens/theme.css:17` 定义 `--color-ml-fg: #1a1a1a`；
   - `apps/site/src/styles/global.css:109` 与 `apps/worker/web/style.css:351` 定义 `--color-ink: #171717` 与 `--ds-gray-1000: #171717`；
   - 部分老组件及内联样式仍使用纯黑 `#000000`（如 `apps/worker/web/support.test.ts:150`）；
   - *影响*：导致营销站、应用外框与部分组件的正文存在微小色差（`#1a1a1a` vs `#171717`）。

2. **品牌紫色/高亮强调色的分裂（6 种不同色值）**：
   - 主 Token：`packages/tokens/theme.css:39` 为 `oklch(0.65 0.15 300)`；
   - 官网渐变紫：`apps/site/src/styles/global.css:128-129` 为 `#a855f7`（Tailwind Purple-500）与 `#6d28d9`（Purple-700）；
   - 演示作者标记：`apps/worker/web/landing/content.ts:31` 为 `#8b5cf6`（Violet-500）；
   - 演示教学目标边框：`apps/worker/web/TeachLayer.tsx:95` 硬编码为 `#7c3aed`（Violet-600）与 `rgba(124,58,237,.2)`；
   - 画板预设色卡：`apps/extension/lib/prefs.ts:20` 为 `#b462f5`；
   - *影响*：全站紫色的色相与明度完全未收敛，呈现碎片化。

3. **成功/通过/在线绿色的分裂（5 种不同色值）**：
   - 状态点/批准绿：`packages/tokens/theme.css:50` 与 `apps/site/src/styles/global.css:138` 使用 `#0a7d33`（`--ds-green-900`）；
   - Resolved 状态色：`apps/extension/lib/status-ui.ts:57` 使用 `#28a948`（`--ds-green-700`）；
   - 状态徽章背景：`apps/extension/lib/status-ui.ts:19` 使用 `oklch(0.7 0.18 145)`；
   - 媒体音视频光环：`apps/worker/web/MediaBubble.tsx:235` 硬编码 `#22c55e`（Tailwind Green-500）；
   - 状态动态变量：`apps/worker/web/style.css:192` 使用 `oklch(0.62 0.17 145)`。

4. **进行中/警告黄色的分裂（4 种不同色值）**：
   - 状态列表指示点：`apps/extension/lib/status-ui.ts:56` 使用 `#ffb200`（`--ds-amber-700`）；
   - 状态徽章背景：`apps/extension/lib/status-ui.ts:13` 使用 `oklch(0.7 0.16 60)`；
   - 语音连接质量：`apps/worker/web/voiceSignals.ts:55` 硬编码 `#f59e0b`（Tailwind Amber-500）；
   - 动态语义变量：`apps/worker/web/style.css:194` 使用 `oklch(0.78 0.16 85)`。

5. **错误/危险红色的分裂（5 种不同色值）**：
   - 基础错误色：`apps/worker/web/style.css:180` 使用 `#fc0035`（`--ds-red-700`，浅色）与 `#f13242`（深色）；
   - 状态变量：`apps/worker/web/style.css:193` 使用 `oklch(0.62 0.22 25)`；
   - 画板红笔：`apps/extension/lib/prefs.ts:26` 硬编码 `#f43f5e`（Tailwind Rose-500）；
   - 语音断连告警：`apps/worker/web/voiceSignals.ts:54` 硬编码 `#ef4444`（Tailwind Red-500）；
   - 演示舞台红绿灯：`apps/worker/web/landing/DemoStage.tsx:6` 硬编码 `#ff5f57`。

---

## 二、字体与排版资产体系

### 2.1 字体家族（Font Family）

- **UI 界面字体**（`--ml-font-ui` / `--font-ui` / `:host > .ml-root`）：
  `"Geist", "Geist Fallback", -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`
  *(在 Extension 的 Shadow DOM 内因 CSP 限制，降级优先使用 `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif`，见 `apps/extension/entrypoints/content/style.css:100`)*。
- **页面叙述字体**（`--ml-font-voice`）：
  `Arial, "Helvetica Neue", Helvetica, sans-serif` *(落地页叙事性文案，模拟 Figma 样式，见 `apps/worker/web/style.css:89`)*。
- **营销站字体**（`--font-sans` / `--font-mono`）：
  `"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif` 与等宽 `ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace`。
- **零布局偏移回退（Metric-Matched Fallback）**：
  `Geist Fallback` 采用系统本地 `Arial`，通过 `size-adjust: 102.01%`、`ascent-override: 98.52%`、`descent-override: 28.92%` 精准对齐 Geist 字形指标，彻底消除字体网络加载阶段的页面抖动（`apps/worker/web/style.css:65-72`）。

---

### 2.2 18 级字阶梯队（Type Steps）与落地场景对照

源自 `packages/ui/src/type-scale.generated.ts` 与各 `@theme` 配置：

| 字阶名称 (Token) | 字号绝对值 | 行高 (Leading) | 字距 (Tracking) | 字重 | 典型应用组件与场景 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `text-micro` | `0.625rem` (10px) | `leading-ui` (1.4) | `tracking-ui` (-0.01em) | 500 | 徽章计数、头像缩写、标尺引导读数（`theme.css:65`） |
| `text-mini` | `0.6875rem` (11px) | 1.0 (`leading-none`)| `tracking-label` (0.011em)| 500 | 测量距离 Chip、快捷键小贴片（`geist.ts:204` 的 `kbd`） |
| `text-meta` | `0.75rem` (12px) | `leading-ui` (1.4) | `tracking-ui` (-0.01em) | 400/500 | 浮层次要信息行、面板小节标题（`sectionLabel`）、操作文字（`actionBtn`、`bareBtn`） |
| `text-fine` | `0.75rem` (12px) | 1.6 | 0 | 400 | 页脚法律声明、商标细字（`apps/site/src/styles/global.css:190`） |
| `text-ui` | **`0.8125rem` (13px)** | `leading-ui` (1.4) | `tracking-ui` (-0.01em) | 400/500 | **产品默认基准字号**！Toolbar 按钮、Input 输入框、下拉菜单项、分段控制器、表单文字（`buttons.ts:19`） |
| `text-label` (site) | `0.8125rem` (13px) | 1.54 | 0 | 500 | 营销站小标签与指示器 |
| `text-ui-lg` | `0.875rem` (14px) | `leading-ui` (1.4) | `tracking-ui` (-0.01em) | 500 | 具有承载力的重要控件按钮、主导航操作 |
| `text-side` (site) | `0.875rem` (14px) | 1.43 | 0 | 400/500 | 文档左侧边栏列表、全局搜索结果行（`global.css:216`） |
| `text-body` | `0.9375rem` (15px) | `leading-body` (1.55)| 0 | 400 | 评论正文、标注详细阐述长文（`theme.css:70`） |
| `text-site-ui` | `0.9375rem` (15px) | 1.5 | 0 | 500 | 官网致密 UI 行、表格单元格、次级按钮（`global.css:182`） |
| `text-site-body` | `1rem` (16px) | 1.65 | 0 | 400 | 官网常规正文段落（`global.css:178`） |
| `text-lede` | `1.0625rem` (17px) / `1.1875rem` (19px) | 1.6 | -0.004em | 400 | 引言段落、文章导语 |
| `text-heading` | `1.1875rem` (19px) | 1.42 | -0.02em | 600 | 卡片主标题、h3、dt 元数据标题（`global.css:169`） |
| `text-intro` | `1.25rem` (20px) | 1.4 | -0.01em | 400 | 落地页 Hero 副标题阐述文案（`apps/worker/web/style.css:104`） |
| `text-title` | `1.5rem` (24px) / `clamp(1.5rem, 1.75rem)` | 1.2 / 1.25 | -0.02em / -0.04em | 600 | 模态框标题、h2 区块大标题（`style.css:109`） |
| `text-statement` | `clamp(30px, 3.4vw, 48px)` | 1.06 | -0.035em | 400 | 落地页叙事性重点声明大段文字（`style.css:120`） |
| `text-display` (site)| `clamp(2.125rem, 2.75rem)` | 1.06 | -0.04em | 600 | 营销站主展示标题 h1（`global.css:153`） |
| `text-hero` (landing)| `clamp(40px, 4.6vw, 64px)` | 1.05 | -0.045em | 400 | 产品首页主 Hero 巨幅标语（`style.css:117`） |

---

### 2.3 字重、行高与字距的固定组合规则

- **UI 控件标准组合**：`text-ui font-medium leading-ui tracking-ui`
  - 广泛用于 `submitBtn`、`secondaryBtn`、`segmentText`、`input`。保证 13px 字体在各平台渲染下既不失真，又具备足够的点按感知。
- **标注长文本标准组合**：`text-body leading-body font-normal`
  - 行高拉大至 1.55，为批注、评论长篇讨论提供极佳的行间透视。
- **微型标签组合**：`text-mini font-medium tracking-label`
  - 11px 在正向微调字距 `+0.011em` 后，快捷键英文字母不粘连。
- **品牌 Wordmark 组合**：`font-bold tracking-brand`（字距紧缩 `-0.045em`），赋予视觉紧凑感。

---

## 三、间距、容器、圆角、Z-Index 与阴影刻度

### 3.1 容器宽度与栅格规则

- **`--container-page: 100rem` (1600px)**：全局主页面最大容器宽度（`apps/worker/web/style.css:134` 与 `apps/site/src/styles/global.css:208`），确保官网与 Web 应用在宽屏视口下页眉、页脚对齐。
- **`--container-column: 44.5rem` (712px)**：营销文档正文核心列宽。
- **Prose Measure: `560px` (`max-w-[560px]`)**：长文本阅读最佳阅读行宽限制。
- **悬浮面板标准宽度**：
  - 小气泡/下拉：`w-64` (256px)、`w-72` (288px)；
  - 常用模态框/抽屉：标准 `w-[360px]`、`w-[380px]`（带有 `max-w-[calc(100vw-32px)]` 移动端兜底）。

---

### 3.2 控件基准高度与间距（Spacings）

- **`h-6` (24px)**：`ctlXs`（微型操作、内嵌清除按钮、`actionBtn`）。
- **`h-7` (28px)**：`ctlSm`、`segment`（面板内部次级控件、分段切换条）。
- **`h-8` (32px)**：`ctl`、`submitBtn`、`secondaryBtn`、`field`（**产品最核心交互控件标准高度**）。
- **`h-9` (36px)**：`row`（菜单项、抽屉设置项的标准点击行高）。
- **间距步进**：`gap-1` (4px)、`gap-1.5` (6px，图文混排标准间隙)、`gap-2` (8px)、`gap-3` (12px)。

---

### 3.3 圆角阶梯（Border Radius）

- **`rounded-sm` (2px)**：快捷键小卡片 `kbd`、超微型芯片。
- **`rounded-md` (6px)**：`submitBtn`、`secondaryBtn`、`field`、`textareaCls`、`actionBtn`、小提示框 `surfaceSmall`（**表单与标准控件基准圆角**）。
- **`rounded-lg` (8px)**：`ctl`（32px 标准按钮，在 12px 容器内留 4px 间隙时严格保证几何同心圆角）。
- **`rounded-xl` (12px)**：`surface`（悬浮工具栏主壳、一级弹窗主壳）。
- **`rounded-2xl` (16px)**：大号独立展示卡片。
- **`rounded-full` (9999px)**：状态圆点、人员头像胶囊、滑动条轨道。

---

### 3.4 阴影体系（Box Shadows）

- **外框微微投影**（`--ds-shadow-border-small` / `--shadow-ring`）：
  - 浅色：`0 0 0 1px #00000014, 0 2px 2px #0000000a`
  - 深色：`0 0 0 1px #ffffff25, 0 1px 2px #00000029`
  - *用途*：分段按钮按下凸起、输入框轻微外圈。
- **气泡小投影**（`--ds-shadow-tooltip`）：
  - 浅色：`0 0 0 1px #00000014, 0 1px 1px #00000005, 0 4px 8px #0000000a`
  - 深色：`0 0 0 1px #ffffff25, 0 1px 1px #00000052, 0 4px 8px #00000052`
- **主菜单/工具栏浮动投影**（`--ds-shadow-menu`）：
  - 浅色：`0 0 0 1px #00000014, 0 1px 1px #00000005, 0 4px 8px -4px #0000000a, 0 16px 24px -8px #0000000f`
  - 深色：`0 0 0 1px #ffffff25, 0 1px 1px #00000052, 0 4px 8px -4px #00000052, 0 16px 24px -8px #00000052`
- **搜索浮动投影**（`--shadow-float`，Site）：
  `0 0 0 1px #00000014, 0 2px 2px #0000000a, 0 18px 36px -14px #00000029`
- **毛玻璃多层复合深层阴影**（`--ml-glass-shadow-small`）：
  `0 0 0 0.5px oklch(0 0 0 / 0.1), 0 6px 24px oklch(0 0 0 / 0.08), 0 16px 48px oklch(0 0 0 / 0.05), inset 0 0.5px 0 oklch(1 0 0 / 0.5)`

---

### 3.5 Z-Index 层级分层模型

系统存在两套截然不同的 Z-Index 规则：

#### 内部常规页面层级
- `z-1`：装饰性光影背景
- `z-10`：工具栏内部按钮相对层级、次级选择器
- `z-20`：视口内固定图层
- `z-40`：项目多标签页栏、设备切换底栏
- `z-50`：顶层应用栏（AppBar）、浮动卡片详情、ViewerChrome
- `z-[100]`：多人协同演示模拟光标（`FakeCursors.tsx:267`）

#### 宿主覆盖物超级层级（Int32 极限梯度，防止被第三方宿主页面覆盖）
- **`z-2147483640`**：扩展 Shadow Root 挂载点容器底层（`App.tsx:142`）
- **`z-2147483645`**：底层画板 Canvas、虚线框预览区、多选框（`Canvas.tsx:225`, `Toolbar.tsx:203`）
- **`z-2147483646`**：标注交互层、十字光标层、HUD 信息栏、选区高亮（`CommentLayer.tsx:70`, `TeachLayer.tsx:81`）
- **`z-2147483647` (2^31 - 1)**：顶层弹窗、Toasts 提示（`Toasts.tsx:35`）、Portal 根容器、下拉菜单与详情抽屉

---

## 四、组件硬编码值违规取证清单 (文件:行号)

以下清单逐项列出在组件内部直接写死颜色（Hex/RGB/OKLCH）或非标准尺寸像素（违反 UI Token 抽象铁律）的具体位置：

### 4.1 硬编码颜色清单（Hex / RGB / OKLCH）

| 违规类型 | 文件路径与行号 | 硬编码代码片段 | 违规内容 |
| :--- | :--- | :--- | :--- |
| **RGB** | [`apps/extension/components/Canvas.tsx:237`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/Canvas.tsx#L237) | `border: '1.5px solid rgba(120, 120, 120, 0.8)'` | 手写灰度边框 rgba |
| **RGB** | [`apps/extension/components/Canvas.tsx:238`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/Canvas.tsx#L238) | `boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.5)'` | 手写白色微光阴影 rgba |
| **OKLCH** | [`apps/extension/components/CommentPinCard.tsx:165`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentPinCard.tsx#L165) | `shadow-[0_0_0_2px_var(--ds-background-100),0_1px_2px_oklch(0_0_0/0.25)]` | Tailwind 类名内嵌手写 oklch 投影 |
| **OKLCH** | [`apps/extension/components/CommentPinCard.tsx:167`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentPinCard.tsx#L167) | `group-hover/pin:shadow-[...,0_1px_2px_oklch(0_0_0/0.3)]` | 手写 oklch 悬浮阴影 |
| **OKLCH** | [`apps/extension/components/CommentTriage.tsx:20`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentTriage.tsx#L20) | `const OFFLINE_COLOR = 'oklch(0.55 0.02 260)'` | 离线灰色硬编码 oklch |
| **OKLCH** | [`apps/extension/components/CommentTriage.tsx:124`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentTriage.tsx#L124) | `shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]` | 内阴影写死白色 oklch |
| **OKLCH** | [`apps/extension/components/GuideLayer.tsx:22-26`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/GuideLayer.tsx#L22-L26) | `GUIDE_COLOR = oklch(0.7 0.19 ${HUE_GUIDE} / 0.7)` 等 5 处 | 标尺色全部使用模板字符串动态拼写 oklch |
| **OKLCH** | [`apps/extension/components/GuideLayer.tsx:168,210,258`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/GuideLayer.tsx#L168) | `boxShadow: '0 2px 8px oklch(0 0 0 / 0.3)'` | 浮动面板阴影写死 oklch |
| **OKLCH** | [`apps/extension/components/HoverTooltip.tsx:25-26`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/HoverTooltip.tsx#L25-L26) | `background: oklch(0.65 0.16 ${hue} / 0.24)` 等 15 处 | DOM 检查工具提示手写多处 oklch 标签色、边框及阴影 |
| **OKLCH** | [`apps/extension/components/InspectorLayer.tsx:442`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/InspectorLayer.tsx#L442) | `style={{ color: 'oklch(0.78 0.13 200)' }}` | 属性名写死青色 oklch |
| **OKLCH** | [`apps/extension/components/InspectorMarkerLayer.tsx:80`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/InspectorMarkerLayer.tsx#L80) | `shadow-[0_1px_2px_oklch(0_0_0/0.25)]` | 标注点手写阴影 |
| **OKLCH** | [`apps/extension/components/MeasureLayer.tsx:21-26`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/MeasureLayer.tsx#L21-L26) | `const FG = oklch(0.78 0.13 ${HUE})` 等 9 处 | 测量层前景、背景、边框、光晕写死 oklch |
| **OKLCH** | [`apps/extension/components/SelectionMarker.tsx:80-82`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/SelectionMarker.tsx#L80-L82) | `shadow-[...,0_1px_2px_oklch(0_0_0/0.25)]` | 选区浮标手写阴影 |
| **OKLCH** | [`apps/extension/components/ThreadCard.tsx:43,60`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/ThreadCard.tsx#L43) | `[box-shadow:0_0_0_0.5px_oklch(0_0_0/0.5),...]` | 讨论卡片手写三重 oklch 复合阴影 |
| **HEX** | [`apps/extension/components/Toolbar.tsx:488`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/Toolbar.tsx#L488) | `color: '#fff'` | 写死纯白文字 |
| **HEX** | [`apps/extension/components/Toolbar.tsx:517`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/Toolbar.tsx#L517) | `boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #000 20%, transparent)'` | 色板手写内阴影混色 |
| **RGB** | [`apps/worker/web/CursorArrow.tsx:11`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/CursorArrow.tsx#L11) | `filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))'` | 光标阴影手写 rgba |
| **RGB** | [`apps/worker/web/CursorLabel.tsx:10-11`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/CursorLabel.tsx#L10-L11) | `borderTop: '0.5px solid rgba(255,255,255,0.25)'` | 光标人名手写白色透明边框与投影 |
| **RGB** | [`apps/worker/web/CursorLayer.tsx:182`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/CursorLayer.tsx#L182) | `ringColor: 'rgba(255,255,255,0.3)'` | 协同头像默认手写外环 |
| **HEX/OKLCH** | [`apps/worker/web/MediaBubble.tsx:235-243`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/MediaBubble.tsx#L235-L243) | `ringColor ?? '#22c55e'`, `rgba(0,0,0,0.55)`, `oklch(0 0 0 / 0.25)` | 媒体气泡同时写死 hex、rgba 与 oklch |
| **HEX** | [`apps/worker/web/SupportDialog.tsx:236`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/SupportDialog.tsx#L236) | `class="relative bg-[#9bc8e4]"` | Tailwind 任意 Hex 写死浅蓝色底 |
| **HEX/RGB** | [`apps/worker/web/TeachLayer.tsx:95`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L95) | `border: '3px solid #7c3aed'`, `boxShadow: '0 0 0 4px rgba(124,58,237,.2)'` | 教学高亮框写死紫色 Hex 与 rgba |
| **RGB** | [`apps/worker/web/TeachLayer.tsx:81`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L81) | `background: 'rgba(80,80,200,.08)'` | 目标拾取遮罩写死 rgba |
| **HEX** | [`apps/worker/web/voiceSignals.ts:54-55`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/voiceSignals.ts#L54-L55) | `'#ef4444'`, `'#f59e0b'` | 语音质量指示硬编码 Red/Amber Hex |
| **HEX** | [`apps/worker/web/feedbackButton.ts:15-17`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/feedbackButton.ts#L15-L17) | `#52525b`, `#18181b`, `#fafafa`, `#a1a1aa` | 反馈按钮内联 CSS 写死 Zinc 色阶全套 |
| **HEX** | [`apps/site/src/components/home/HomeContent.astro:18`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/site/src/components/home/HomeContent.astro#L18) | `style="color: #6e6e6e"` | 官网正文内联写死灰色 |

---

### 4.2 硬编码像素尺寸清单（Tailwind 方括号任意像素 / 内联 style 像素）

| 违规类型 | 文件路径与行号 | 硬编码代码片段 | 违规内容 |
| :--- | :--- | :--- | :--- |
| **Tailwind [..px]** | [`apps/extension/components/AreaCard.tsx:53`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/AreaCard.tsx#L53) | `w-[320px]` | 抽屉卡片写死 320px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/AreaLayer.tsx:210,214`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/AreaLayer.tsx#L210) | `w-[14px] h-[14px]` | 拖拽调节手柄写死 14px 尺寸 |
| **Tailwind [..px]** | [`apps/extension/components/CommentPinCard.tsx:211`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentPinCard.tsx#L211) | `w-[280px]` | 评论卡片写死 280px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/CommentPopover.tsx:325`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CommentPopover.tsx#L325) | `w-[300px]` | 评论浮层写死 300px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/CssEditor.tsx:112`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/CssEditor.tsx#L112) | `min-w-[120px]` | CSS 规则编辑器写死最小宽度 |
| **Tailwind [..px]** | [`apps/extension/components/GuideLayer.tsx:162,204`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/GuideLayer.tsx#L162) | `text-[10px]` | 标尺数值写死 10px（未用 `text-micro`） |
| **Tailwind [..px]** | [`apps/extension/components/HoverTooltip.tsx:47,79`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/HoverTooltip.tsx#L47) | `max-w-[420px]`, `text-[11px]` | 检查气泡宽度与字号写死（未用 `text-mini`） |
| **Tailwind [..px]** | [`apps/extension/components/IdentityCard.tsx:84`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/IdentityCard.tsx#L84) | `w-[260px]` | 用户身份卡片写死 260px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/InspectorLayer.tsx:247`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/InspectorLayer.tsx#L247) | `w-[340px]` | 检查面板写死 340px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/InspectorMarkerLayer.tsx:39,40`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/InspectorMarkerLayer.tsx#L39) | `text-[10px]`, `w-[14px] h-[14px]` | 检查标号字号与方块尺寸写死 |
| **Tailwind [..px]** | [`apps/extension/components/LayerPanel.tsx:31`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/LayerPanel.tsx#L31) | `w-[240px]` | 图层面板写死 240px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/MeasureLayer.tsx:81`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/MeasureLayer.tsx#L81) | `text-[10px]` | 测量标签写死 10px 字号 |
| **Tailwind [..px]** | [`apps/extension/components/MultiInspectLayer.tsx:165,166`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/MultiInspectLayer.tsx#L165) | `w-[16px] h-[16px] text-[10px]` | 多选检查圆标尺寸与字号写死 |
| **Tailwind [..px]** | [`apps/extension/components/SelectionComposer.tsx:114`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/SelectionComposer.tsx#L114) | `w-[300px]` | 选区批注输入框写死 300px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/SelectionEdit.tsx:42`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/SelectionEdit.tsx#L42) | `w-[360px]` | 选区修改弹窗写死 360px 宽度 |
| **Tailwind [..px]** | [`apps/extension/components/ShareDialog.tsx:123`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/extension/components/ShareDialog.tsx#L123) | `w-[380px]` | 分享对话框写死 380px 宽度 |
| **Tailwind [..px]** | [`apps/worker/web/CursorLayer.tsx:193-194`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/CursorLayer.tsx#L193) | `w-[2.5px] h-[10px]` 等 | 语音音量波动条写死任意细像素 |
| **Tailwind [..px]** | [`apps/worker/web/dashboard/Dashboard.tsx:217`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/dashboard/Dashboard.tsx#L217) | `h-[71px]` | 骨架屏列表项高度写死 71px |
| **Tailwind [..px]** | [`apps/worker/web/dashboard/Folders.tsx:196`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/dashboard/Folders.tsx#L196) | `w-[360px]` | 文件夹弹窗写死 360px 宽度 |
| **Inline style** | [`apps/worker/web/TeachLayer.tsx:65,87`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/TeachLayer.tsx#L65) | `width: 24, height: 24`, `width: 320` | 教学目标方块与面板内联写死像素尺寸 |
| **Tailwind [..px]** | [`apps/worker/web/ProjectTabs.tsx:120,176`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/ProjectTabs.tsx#L120) | `max-w-[180px]`, `w-[280px]` | 项目标签与搜索框写死宽度 |
| **Tailwind [..px]** | [`apps/worker/web/ViewerHud.tsx:57,76,83`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/ViewerHud.tsx#L57) | `top-[60px]`, `gap-[2px]`, `w-[2.5px]` | HUD 控件偏移与音量条宽度写死 |
| **Tailwind [..px]** | [`apps/worker/web/WebAreaShape.tsx:36,53`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/WebAreaShape.tsx#L36) | `rounded-[3px]`, `width: 14, height: 14` | 区域选框圆角与手柄尺寸写死 |
| **Tailwind [..px]** | [`apps/worker/web/WebCommentPin.tsx:45`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/worker/web/WebCommentPin.tsx#L45) | `max-h-[400px]` | 评论卡片滚动上限写死 400px |
| **Tailwind [..px]** | [`apps/site/src/components/SiteHeader.astro:33,51`](file:///C:/Users/xxc/orca/workspaces/visual%20collaboration/agy-worker-2026-11-11/apps/site/src/components/SiteHeader.astro#L33) | `-mr-[9px]` | 营销站导航栏微调负外边距写死 |

---

## 五、总结：最值得守的 3 个 Token 与最容易写死的地方

### 5.1 最值得坚守的 3 个核心 Token

1. **`--text-ui: 0.8125rem` (13px)**
   - **理由**：它是整套系统 Chrome UI 的中枢灵魂。从顶部 Toolbar 按钮、输入框、下拉菜单，到面板小节、确定提交按钮全部依附于它。13px 是既能避开移动端缩放惩罚，又能在紧凑桌面端保证密度的黄金字号。一旦守不住、在子组件里随意写死 12px/14px，整个产品的层级层次与质感将瞬间坍塌。
2. **`--ds-gray-1000` 与 `--ds-background-100` 对偶**
   - **理由**：Geist 系统的精髓在于**通过黑白极性翻转达成最高对比度**，而非依赖高饱和彩色。浅色模式下为 `#171717` 文字配 `#ffffff` 底；深色模式下为 `#ededed` 配 `#000000` 底。所有的主要按钮（`submitBtn`）都是直接提取这对极性构建的。一旦有人随手写死 `#fff` 或 `#000`，深色模式切换时就会直接爆发白底白字或黑底黑字的致命对比度事故。
3. **`z-2147483647` 与扩展端分层梯队（`z-2147483645` ~ `z-2147483647`）**
   - **理由**：作为嵌入在任意第三方网页中的 Chrome 扩展程序，必须在宿主页面可能拥有的任意极端 `z-index: 99999` 面前维持绝对控制权。`z-2147483645`（底板/虚线）、`z-2147483646`（交互命中）、`z-2147483647`（菜单/弹窗/Toast）这组 Int32 极限阶梯是经过实战验证的铁律。任何人若在弹窗中图省事写 `z-50`，在复杂的真实业务网页上就会被宿主元素直接遮挡导致功能瘫痪。

### 5.2 最容易写死的三大重灾区

1. **新交互与临时高亮层的内联 `style={{ ... }}`（重灾区第一名）**
   - 典型代表：`apps/worker/web/TeachLayer.tsx:95`（`style={{ border: '3px solid #7c3aed', boxShadow: '0 0 0 4px rgba(124,58,237,.2)' }}`）与 `apps/extension/components/HoverTooltip.tsx`。
   - *病因*：开发新功能（如教学高亮指示框、DOM检查工具）时，开发者图快直接内联调试颜色和像素，未在 `@theme` 或 `geist.ts` 中沉淀标准 Recipe。
2. **多层复合微阴影与光晕（OKLCH / RGBA 手搓）**
   - 典型代表：`CommentPinCard.tsx:165`、`GuideLayer.tsx:168`、`ThreadCard.tsx:60`。
   - *病因*：系统现有 shadow token 只覆盖了 `shadow-menu` 与 `shadow-tooltip`，缺乏针对卡片外框光晕（`0 1px 2px oklch(...)`）的标准原子类，导致开发者在数十个组件里各自手写不同透明度的 OKLCH 投影。
3. **模态弹窗与浮层卡片宽度（Tailwind 任意方括号 `w-[...px]`）**
   - 典型代表：`w-[240px]`、`w-[280px]`、`w-[300px]`、`w-[320px]`、`w-[340px]`、`w-[360px]`、`w-[380px]` 遍地开花。
   - *病因*：组件各自为政，未在 Design System 层面定义 `panel-sm`、`panel-md`、`panel-lg` 等标准面板规格尺寸，导致每新做一个 Dialog 或 Popover 就随手创造一个新的像素值。
