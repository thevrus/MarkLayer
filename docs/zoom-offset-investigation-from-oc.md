# 浏览器放大后批注框位置偏移：代码调研

调研基线：`6948e78`（仅静态阅读，未改代码、未做真实浏览器复现）。

## 前置说明

当前工作树没有 `docs/visual-collaboration-progress.md`，`git log --all -- docs/visual-collaboration-progress.md` 也没有记录，因此无法引用其中“第一阶段”的约定。以下结论直接来自当前扩展实现；若第一阶段另有坐标契约，需要补齐该文档后再核对。

## 结论摘要

**不要在 `toDoc()` 里额外除以 `devicePixelRatio`、浏览器缩放倍率或 `<html>` 的 CSS zoom。** 点击事件、`getBoundingClientRect()`、`innerWidth` 和扩展 overlay 的 `left/top` 已经在 viewport CSS px 这一坐标空间中；截图则单独把 CSS px 转为位图像素。额外除一次会把两个坐标空间再次混用。

代码中能确定的偏移根因是：**comment 草稿没有使用同一时刻的锚点几何，也没有在缩放引起 reflow 时统一重锚。**

- `x/y` 和截图在点击时生成，但 `target.rect/offsetX/offsetY` 到 Post 才生成。若浏览器缩放发生在点击与 Post 之间，保存的是“点击时的 `x/y` + Post 时的元素 rect/scroll”，二者不属于同一几何快照。
- 打开的批注框只用旧的 `toClient(popover)` 定位；`CommentLayer` 不订阅 `resize` 所驱动的 `scrollTick`，所以缩放后不能像已发布的 pin 一样重算位置。
- 页面 CSS zoom 还有一条独立的失效缺口：`<html>` 的 zoom watcher 只给 overlay host 设置 `1/z`，没有触发锚点重算。浏览器缩放通常会触发 `resize`，CSS zoom 改变则不一定会。
- 无 `target` 或 target 无法解析的评论始终退回旧文档坐标；它们没有任何机制跟随缩放导致的 reflow。

因此，若复现时序是“打开批注框后放大”或“点击后、Post 前放大”，上述两条草稿路径就是直接根因。若问题是“已经发布、带有效 target 的 pin 在稳定页面上放大后仍偏移”，当前代码已有 `resize → scrollTick → applyAnchorDelta` 路径，仅凭静态代码不能归因于缺少缩放逆变换，需要补实测数据定位是哪一步失真。

## 坐标链路

记：

- `C = (clientX, clientY)`：点击的 viewport CSS 坐标。
- `S = scrollOffset(window)`：文档滚动量与检测到的内层主 scroller 滚动量之和。
- `R = el.getBoundingClientRect()`：目标元素的 viewport rect。
- `D = (op.x, op.y)`：存储的文档坐标。

### 1. 点击与批注框

`apps/extension/components/CommentLayer.tsx:46-63`：

```text
D0 = C0 + S0
```

这里调用 `toDoc()`；`apps/extension/lib/scroller.ts:69-88` 证明 `toDoc/toClient` 只做滚动加减：

```text
toDoc(C)   = C + S
toClient(D) = D - S
```

没有 CSS zoom、浏览器 zoom 或 DPR 因子。`CommentLayer.tsx:83-93` 又通过 `toClient(popover)` 得到草稿批注框的 `anchorAt`，但组件本身没有读取 `scrollTick/hostMutationTick`。

`apps/extension/components/CommentPopover.tsx:273-314` 将 `anchorAt` 当作 viewport CSS px，直接写入 fixed 面板的 `left/top`。`useEdgeClamp` 虽在 `apps/extension/lib/popover.ts:40-58` 监听 `resize`，它只重新夹紧旧 `top`，不会重新计算父组件传入的锚点。

### 2. target 当前到 Post 才捕获

点击时 `CommentLayer.tsx:51-62` 只保存 `el` 引用；真正的 `captureTarget()` 在 `CommentLayer.tsx:86-93` 的 `capture()` 内，而 `capture()` 到 `apps/extension/components/CommentPopover.tsx:99-140` 的 Post 流程才执行。

`apps/extension/lib/selector.ts:74-101` 当前保存的是：

```text
E1 = R1 + S1
offset = D0 - E1
```

下标 0 是点击时，下标 1 是 Post 时。正确且自洽的快照应当是在点击时同时得到：

```text
D0 = C0 + S0
E0 = R0 + S0
offset = D0 - E0 = C0 - R0
```

一旦中间发生浏览器缩放、CSS zoom、滚动或 reflow，当前实现就会把 `D0` 与 `R1/S1` 混合。`captureViewport` 也在 Post 时读取，进一步说明草稿没有原子几何快照。

### 3. 已发布 pin 的重锚

`apps/extension/lib/anchor.ts:104-141` 使用：

```text
scaleX = currentRect.width  / capturedRect.width
scaleY = currentRect.height / capturedRect.height
D' = currentRect + currentScroll + capturedOffset * scale
```

`apps/extension/components/CommentPin.tsx:13-25` 再通过 `toClient(D')` 得到屏幕位置。若 rect 和 offset 来自同一快照、布局没有变化，公式会严格还原为原点击点 `C`，不需要再除以 zoom。

已发布 pin 订阅了 `scrollTick` 和 `hostMutationTick`。`apps/extension/lib/host-mutations.ts:23-38` 将 scroll/resize 合帧后增加 `scrollTick`，所以浏览器缩放引发的 viewport resize 正常会促使它重锚。

但 `apps/extension/lib/anchor.ts:211-217` 规定：无 target 或解析失败时直接返回旧 `D`，不做任何重投影。这类评论无法跟随 reflow，不能靠补一个 DPR 除法修复。

## 两条缩放路径

| 环节 | 页面 CSS zoom | 浏览器缩放（Ctrl/Cmd +、菜单缩放） |
| --- | --- | --- |
| overlay | `apps/extension/lib/overlay-mount.ts:45-61` 读取 `<html>` computed `zoom = z`，给 host 设置 `zoom: 1/z`，抵消页面 zoom 的继承/乘法 | 不读取 `browser.tabs.getZoom()`，也不给 host 做额外逆缩放；浏览器统一放大页面与 fixed overlay 的 CSS 渲染 |
| 屏幕点 → 文档点 | `toDoc()` 仍是 `client + scroll`，不除 `z`；事件 client 坐标与元素 rect 都按 viewport CSS px 使用 | 同一条路径，不除 DPR 或 browser zoom；浏览器缩放不是另一套 DOM 坐标单位 |
| 锚点重算 | html 属性 watcher 只执行 `unzoom()`；body observer 看不到 `<html>` 自身的属性变化，因此动态 CSS zoom 可能直到下次 scroll/resize/body mutation 才重锚 | `resize → scrollTick → CommentPin → applyAnchorDelta` 已存在；草稿批注框没有订阅这条 signal 链 |
| 截图 | crop 始终使用 viewport CSS px；CSS zoom 不作为截图位图倍率 | `apps/extension/entrypoints/background.ts:7-20` 用实际 `bitmap.width / crop.viewportWidth` 得到位图倍率，不显式假设它等于 DPR |

CSS zoom 的 overlay 逆变换只负责让扩展 UI 不被页面放大；它不是 comment 文档坐标的换算系数。把 `1/z` 再塞进 `toDoc()` 会把“取消 overlay 自身缩放”误当成“修正 DOM 事件坐标”。

## 截图不是需要补 DPR 逆变换的地方

点击时，`CommentLayer.tsx:53-60` 把原始 `clientX/Y` 交给 `snapshotPin()`，不加滚动。`apps/extension/lib/pin-shot.ts:38-46` 以同一 viewport CSS 坐标计算 crop。

随后：

1. `apps/extension/lib/capture.ts:56-60` 发送 CSS px crop，并附 `window.innerWidth`。
2. `apps/extension/entrypoints/background.ts:10-20` 计算 `q = bitmap.width / viewportWidth`，用 `q` 将 crop 的源坐标和尺寸转为位图像素。
3. `apps/extension/lib/pin-shot.ts:50-68,108-117` 再按最终 canvas 尺寸计算 `perCssPx`，圆点为 `(pin - cropOrigin) * perCssPx`。

这条链路已经显式处理浏览器缩放与设备像素共同决定的位图密度。注释也特别说明不能直接信任 `devicePixelRatio`，因为 zoom 对二者的影响不同。截图 crop、截图内圆点和 DOM 锚点分别有自己的换算，不应共用一个 zoom 除数。

## 最小修复方案

### A. 让草稿使用点击时的原子锚点快照（核心修复）

在 `CommentLayer.onClick()` 中、启动截图的同一时刻：

1. 计算 `D0` 后立即对 `el` 调用 `captureTarget({ el, anchor: D0 })`。
2. 将返回的 target、点击时 `captureViewport` 一起存入 `PopoverState`。
3. Post 时原样返回这份 target/viewport，不再重新读取 Post 时的 rect、scroll 和 viewport。

这样截图、`x/y`、target rect、offset 和 capture viewport 都来自点击时。之后发生缩放时，现有 `applyAnchorDelta()` 就能用“旧快照 → 当前 rect”正确重投影。

### B. 让尚未 Post 的批注框也走同一条重锚路径

让草稿批注框所在组件订阅 `scrollTick/hostMutationTick`，每次几何失效后：

```text
resolved = applyAnchorDelta(点击时 target, 点击时 x/y fallback)
anchorAt = toClient(resolved)
```

不要只重跑旧的 `toClient(popover)`，因为那只能跟滚动，不能跟缩放导致的元素 reflow。无 target 时仍保留旧坐标 fallback，与已发布 pin 行为一致。

A + B 是修复“浏览器放大后草稿框/最终 pin 偏移”的最小闭环，不需要改 op schema，也不需要新增 browser-zoom 字段。

### C. 补齐动态 CSS zoom 的失效通知

复用 `host-mutations.ts` 现有的 rAF 几何调度，在 `overlay-mount.ts` 的 html zoom watcher 执行 `unzoom()` 后触发同一 tick。这样 CSS zoom 与浏览器 resize 都进入相同的重锚流程，而不是只修正 overlay 外观。

### 明确不做

- 不给 `toDoc()/toClient()` 增加 `/ devicePixelRatio`、`/ browserZoom` 或 `/ htmlZoom`。
- 不把 background 已验证位图尺寸的 `bitmap.width / viewportWidth` 改成 DPR。
- 不用浏览器缩放比对旧文档坐标做整体缩放；浏览器缩放后元素是否移动取决于 CSS 布局/reflow，必须由当前元素 rect 重锚，不能用 zoom 比例猜测。

## 回归验证建议

1. **点击—Post 时间窗**：点击后改变 viewport/模拟缩放和元素 rect，再 Post；断言保存的 target 仍是点击时 rect/offset，最终 pin 按当前 rect 重投影，截图仍是点击时画面。
2. **草稿 resize**：批注框打开时触发 resize/reflow；断言 `anchorAt` 更新，而不只是 `useEdgeClamp` 夹紧旧位置。
3. **动态 CSS zoom**：只修改 `<html style="zoom: …">`，不产生 scroll/resize/body mutation；断言 host 为 `1/z` 且 pin、草稿框都重算。
4. **截图倍率**：覆盖 `bitmap.width / innerWidth` 小于、等于、大于 1，验证 crop 与圆点一致，并确认实现不读取 DPR 作为替代倍率。
5. **真实 Chromium 矩阵**：页面 `html zoom = 1/1.5` × 浏览器 `100%/125%/150%`，分别覆盖“创建前已缩放”“点击与 Post 之间缩放”“Post 后缩放”、滚动、内层 scroller、无 target 空白区域。

现有 happy-dom 单测没有真实 layout，不能替代最后的 Chromium 矩阵。实测时至少同时记录 `clientX/Y`、scroll、target rect、`innerWidth`、`bitmap.width` 和最终 pin 的 `left/top`，以区分 DOM 锚点错误与截图位图错误。
