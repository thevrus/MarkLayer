# 3.1 按需元素读取：真实 Edge 验收通过

## 结论

本轮五项验收逐条完成；**未修改功能源码、未新增产品功能、没有功能修复提交**。使用同一个有窗口的本机 Edge、同一个 profile/CDP 和同一个 fixture 标签页完成读取、复制失败重试、连续分批及工具切换重置。进度文档仅关闭 3.1 的按需分批读取项；另外两项不随本轮全部关闭。

## 版本和实例绑定

- 开始 HEAD：`4e7a340cf950caa8ee7e1a725b58e6bba600ff2c`。
- 收尾前 HEAD：`d3d62e86f7943b5cffb00a74140643500c3dcf78`。验收期间出现了其他工作提交「支持注册界面语义规格」，以及若干未跟踪设计规范文件，本轮没有修改或暂存它们。实际加载包以 build-provenance.json 的哈希为准；包中 source map 嵌入的 viewport-reader.ts、InspectorLayer.tsx 均与当前源文件逐字匹配。
- 浏览器：本机 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`，CDP 版本 `Edg/157.0.4341.42`，扩展版本 `0.11.0`，扩展 ID `ncafcnadnalaeegknollpfmejnefpgmb`。
- 同一个 Edge 主进程 PID **23204**、窗口 ID **381087161**、测试 profile `<本目录>/.edge-profile`、CDP **9336**；现有驱动网关 **5201**。单实例记录见 single-instance.json / owned-processes-before.json。Renderer/GPU/utility 为此实例必要子进程，保留；日常 Edge 未动。
- fixture：`http://127.0.0.1:5199/fixture.html`；同源 iframe 为 5199 的 child.html，跨源 iframe 为 `http://127.0.0.1:5200/child.html`。本地端口不同即为不同 origin，没有使用外网测试页。
- 源码以 WXT 构建到本目录 `unpacked/chrome-mv3`，使用 `Extensions.loadUnpacked` 安装。验收构建关闭压缩并启用 source map，用于观察原函数调用，不改变函数实现。将构建根隔离后，显式指定 Tailwind 扫描原扩展目录，以保留真实面板样式。
- 启动参数没有 headless。浏览器实测 viewport 为 **1418×862 CSS px**、DPR **1.5**，主截图为 **2127×1293 像素**，没有 DeviceMetricsOverride。`Page.captureScreenshot` 直接获取真实 Edge 页面渲染，画面可见实际页面、Inspect 面板、按钮和 toast；它不包含浏览器地址栏，浏览器身份另由进程、版本与 target 绑定确认。

## 五条逐项验收

### 1. 点一次只读一批；不点击时不扫描 —— 通过

操作：用已加载扩展的默认动作启用标注（`Extensions.triggerAction` 的 targetId 使用 `type=tab` 的目标），点击底部 **Inspect**，再点击绿色 **Inspect this target**。展开的是真实扩展 Inspect 面板，按钮文案是 **读取视口下一批**。

- 点击读取按钮前等待 **1.5 秒**，原 `createViewportReader` 和 `readNext` 调用计数均为 0，剪贴板批次产出为 0；控制用的 native clipboard sentinel 未变化。
- 点击一次，factory +1、readNext +1、原生剪贴板仅新增一批 **20 条**，`done=false`。
- 另通过 Debugger 调用原 factory，仅创建 reader 并等待 1 秒：factory +1，readNext 增量 **0**，没有复制新批次。该创建检查是观察原函数，未替换其算法，也没有用模拟 DOM。

证据：[点击前截图](shots/01-before-click.png)、[一次点击后截图](shots/02-after-one-click.png)、[仅创建后截图](shots/03-factory-created-no-read.png)、[step1.json](step1.json)、[首批原始 JSON](batches/01.json)。

### 2. 隐藏/离屏排除、溢出后代和可见交集 —— 通过

fixture 中存在 display:none、aria-hidden、inert、透明容器及其后代、离屏按钮/父容器、页面 6000px 下方按钮，另有从离屏父容器溢出到视口的 fixed 按钮。

- 检查 11 个排除样本选择器，最终导出的 108 条记录中命中数为 **0**。aria-hidden/inert 在画面上仍可见，不影响它们应从可访问元素导出中排除。
- `#overflow-child` / `VISIBLE_OVERFLOW_DESCENDANT` 正常返回，实际 rect 位于视口内。
- `#partial-edge` 的原生 rect 为 **(-40,90,100,42)**；返回 `visibleRect` 为 **(0,90,60,42)**，与独立读取的实际 viewport 交集一致。

证据：[可见区域与边界截图](shots/06-exclusions-and-frame-boundaries.png)、[visibility.json](visibility.json)、fixture.html、batches/stable-01.json 至 stable-06.json。

### 3. 长页分批无重复、结束和重置 —— 通过

fixture 有 100 个网格按钮及长页面。通过真实按钮启动一个干净、连续、不间断的周期：

| 批次 | items | visited | done | restarted |
|---|---:|---:|---|---|
| 1 | 20 | 22 | false | true |
| 2 | 20 | 20 | false | false |
| 3 | 20 | 20 | false | false |
| 4 | 20 | 20 | false | false |
| 5 | 20 | 20 | false | false |
| 6 | 8 | 19 | true | false |

- 共 **108 个唯一选择器**，100 个网格按钮全部出现，批次间重复 **0**；每批最多 20 条、访问节点均不超过 200。
- 完成后空闲 1 秒，读取和复制计数不增加；再次明确点击只返回 `items=[]、done=true、restarted=false`，没有自动重扫。
- 点击 **Move → Inspect → Inspect this target → 读取视口下一批**，新建 reader，返回 `restarted=true`，首批 20 个选择器与原首批完全相同。
- 早先执行跨用户交互暂停时，原始 batch 03 明确返回 `restarted=true`，所以 batch 01/02 与 03 起不是同一个读取周期，不能拼起来做去重。该记录完整保留在 interrupted-cycle-note.json 和 batches/01.json 至 08.json。表中使用重新切换工具后完整、连续的 stable-01 至 stable-06，严格检查周期内去重，未删除跨周期重复记录。

证据：[工具重置截图](shots/07-tool-reset.png)、[读取结束截图](shots/08-complete-no-duplicates.png)、[batch-summary.json](batch-summary.json)、batches/stable-01.json 至 stable-06.json、batches/after-done.json、batches/after-tool-reset.json。

### 4. iframe 只报告边界；复制失败重试同一批 —— 通过

**iframe：** 主文档实际包含一个同源 iframe 和一个跨源 iframe。独立检查确认同源子文档确实存在内部按钮、跨源子文档访问被浏览器同源策略拒绝。读取结果仅有 `#same-frame`、`#cross-frame` 两条 `boundary=iframe` 记录；没有内部按钮/选择器，没有导出 src 字段或 iframe URL 中的 sentinel。独立审计的 frame-resource-tree.json 会记录本地 iframe URL，用于证明 origin；它不是产品导出的元素批次。

**复制：** 在扩展 isolated world 给原生 `clipboard.writeText` 加观察代理，成功分支仍调用原生 API；本轮只注入 **一次** NotAllowedError 拒绝，这是 BRIEF 明确要求的故障点。实际按钮显示「复制失败，请点击重试当前批次」。再次点击后：

- 失败与重试传给原生 API 的完整 JSON 文本逐字节一致，SHA-256 均为 `aa89cf96f0f00dc708f028112ff48d89d2c7b1d5c480fa8a2aadc7873e74b410`。
- 重试前后 readNext 计数均为 **2**，增量 **0**，说明使用保留的 pending batch，没有继续读下一批。
- 重试调用成功，实际系统剪贴板回读的完整 JSON 对象与失败批次完全一致。Windows 会把文本换行规范化为 CRLF，因此分别保留 API 入参和原生剪贴板原始哈希，不把文本换行差异当作内容丢失。
- 原始 native clipboard 回读已保存在 retry-investigation.json；跨用户暂停后剪贴板可能变化，后续报告使用当时已捕获的读回证据，没有重新注入失败或重造那次回读。

证据：[复制失败截图](shots/04-copy-failure.png)、[重试审计截图](shots/05-copy-retry-same-batch.png)、[copy-retry.json](copy-retry.json)、retry-investigation.json、visibility.json、frame-resource-tree.json、final-browser-audit.json。

### 5. 版本、操作步骤、原始证据和未覆盖范围 —— 通过

本报告、构建与源码哈希、全部 JSON 批次、原生剪贴板观察记录和真实渲染截图均在本目录。计数 HUD 是 fixture 的审计显示，内容来自上述已核对的计数/结果；真实面板、读取按钮和成功/失败 toast 均由扩展本身绘制。

复查步骤：

1. 保持当前 PID 23204 / profile / CDP 9336，使用 client.mjs 与现有 5201 网关；不要再运行 driver.mjs 另开实例。换场景应导航现有标签页。本轮驱动已有重复启动拒绝检查。
2. 打开本地 fixture.html，确认同源与跨源 child.html 均存在；当前现有页已经加载。首次启用扩展用 Extensions.triggerAction，参数必须是 tab target，不是 page target。
3. 在工具栏点击 Inspect，点击绿色 Inspect this target，在真实面板点击读取视口下一批。将系统剪贴板 JSON 保存后继续点击，第 6 批结束；不要把滚动/页面变化后 restarted=true 的不同周期合并做去重。
4. 切换 Move 再回 Inspect，重新选中目标并点击读取，确认首批重来。
5. 故障注入与调用计数的确切实现见 step1.mjs、finish.mjs、complete-review.mjs、client.mjs；故障只在 clipboard 代理的一次拒绝，读函数、DOM 几何和成功复制路径仍为真实原实现。脚本保存的是本次分阶段执行过程，不应直接在已有计数/游标上重跑来覆盖证据。

## 本轮环境与验收脚本问题

- 起初 pipe 模式没有完成握手，改用同一测试 profile 的端口模式后加载成功；没有遗留第二个测试主实例。
- Windows 窗口工具无法可靠识别 URL，被自动安全审查停止。没有继续调用窗口工具；随后用户明确改为 CDP 路径，当前页面 URL、profile、版本和 target 均已核对。
- 验收脚本曾把 Windows CRLF 当成 JSON 内容变化；以严格 API 入参哈希及完整 JSON 对象对比纠正。另一项是将两次 restarted 周期混在一起导致表面重复；保留原记录并重新做干净连续周期核验。
- 以上均为验收准备/脚本处理，不涉及功能源码修复。没有为了验收修改 viewport-reader.ts 或 InspectorLayer.tsx。

## 未覆盖边界

- 固定本地 fixture、Edge 157、单个原生 DPR 1.5；没有跨浏览器/多 DPR 矩阵、复杂真实站点的性能基准或大规模压力测试。
- 未验证完整浏览器 AX tree、完整 ARIA 命名、遮挡/clip-path/复杂旋转，或真实站点对剪贴板的全部权限策略。失败注入不是 HTTP 401，也不是证明所有 OS 权限失败路径。
- iframe 只验证边界、不深读；没有跨文档读取或 MCP 远程读取能力。开放 shadow root 的细分场景沿用既有单测，本轮未另做真实专项。
- 没有验证 Comment 定位策略与 DOM 线索的关系，没有完成图片/PDF/Canvas/旧房间兼容性，因此阶段三后两项仍未整体勾选。
- 没有重新运行全量 bun test/tsc：本轮功能源码无变化，按 BRIEF 的功能修复条件无需生成修复提交。执行了真实 Edge 五条验收、构建、JSON/计数交叉核对、文档链接和 diff 检查。

## 产物和提交范围

- `shots/01-before-click.png` 至 `08-complete-no-duplicates.png` 为八张主证据；另有中间批次截图。图片尺寸及哈希见 screenshot-manifest.json。
- `step1.json`、`visibility.json`、`batch-summary.json`、`copy-retry.json`、`acceptance-checks.json`、`final-browser-audit.json`、`frame-resource-tree.json`、`build-provenance.json` 是结构化证据；batches/ 保留所有原始 JSON。
- build.mjs / driver.mjs / client.mjs / fixture.html / child.html / step1.mjs / finish.mjs / complete-review.mjs 及 build.log / driver.log 记录构建和操作过程。
- `.edge-profile`、unpacked/、.wxt/、vite-cache/、temp/ 保留在本验收目录，供复用/复查，不纳入本次提交。
- 按授权仅提交本 RESULTS.md 与 docs/visual-collaboration-progress.md；其余原始证据、运行目录和无关设计规范/既有基线修改均留在工作区。没有 push。验收后已恢复原生剪贴板方法、清除 Debugger 计数断点并关闭 focus emulation、撤回临时 clipboard 权限授予；同一个窗口/profile/CDP 保留供后续验收，见 cleanup.json。
