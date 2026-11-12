> 这份是给远程验收用的状态快照。想自己跑一遍看现状：见仓库根 `README.md`；
> 六阶段逐条证据在 `docs/visual-collaboration-progress.md`（每项都标了验证方式）。
> 最后更新：2026-11-12 16:40(UTC+8)
# Visual Collaboration · v0.1 / v0.2 完成度快照（2026-11-12 16:35）

依据：`D:\visual collaboration\docs\visual-collaboration-progress.md`（六阶段，逐项带证据）+ 代码现状 grep。
是**估算**，不是逐条审计；要精确数字得派 agent 做一次 item-by-item 核对。

## v0.1 · Browser Visual Collaboration —— 约 65%

| 首发 5 件 | 状态 | 证据 / 缺口 |
|---|---|---|
| ① 浏览器覆盖层与空间批注 | **做了，可靠性有缺口** | `WebAreaLayer` / `WebCommentPin` / `WebCommentPin` / 画笔高亮形状都在；`1443a02` anchor 语义拆分 + P1 真机几何（CSS 缩放 125/150/200%、DPR 1–2 共 16 组合 pin 差 0）。**缺口**：1.3 浏览器原生 Ctrl++ 后批注跑出屏幕（他自己遇到过「放大后批注隐藏到右边」），Ctrl+0 恢复未记录 |
| ② 自动附带截图及 DOM 上下文 | **大半做了** | 默认 800×500 取样、宽高滑杆、中央虚线框、撰写时放大预览（`97ae62b`）；当前图层空间上下文（`53acfc7`/`6948e78`）；视口元素按需分批读取 3.1 **真实 Edge 通过**。**缺口**：2.3 空框——实际扩展截图入口的 UI 完整性、边缘/DPR/中途改尺寸未全验 |
| ③ Agent 通过 MCP 读取并回复 | **通过** | 6.1 已关：真实 agy 经 MCP 读 A/B 评论 + 两张截图附件 → 原线程 `marklayer_reply`；回读核对 author=agy。**边界**：图片是 CLI 落盘后授权 `read_file` 才看见，不是 image content 直进模型 |
| ④ 人类与 Agent 独立图层 | **半成品** | `layerId` / `assignedLayer` / 分层拒绝（`layer_change_refused`）机制在，agent 回复带 author 区分。**缺口**：没做过「人一层、agent 一层」的真实可见性验收 |
| ⑤ 操作权限、确认、同步可靠 | **红灯** | 有 `mayEdit` / 房间锁 / `refused` 三态；但 **ACK/NACK 是今天才派修**（`agent/ack-nack-2026-11-12`），客户端 fire-and-forget + 乐观更新、被拒不回滚 |

**离能发还差三件**（Muse 那轮审计给的，我认同）：
1. ACK/NACK 修掉并真机验（今天在做）
2. 从零录一段演示视频，完整跑通「圈三样东西 → AI 回带改法的批注」
3. 真实浏览器缩放 + 物理高分屏验收（1.3 / 6.2）

## v0.2 · Agentic Interface —— 约 10%

| 项 | 状态 |
|---|---|
| 语义注册表查询 API | **只有协议 + 校验 + 受控编译层**（`f6bd48f`：`ui-semantics.ts` 461 行、`docs/ui-semantics-registry-protocol.md`），跑在**扩展里**；服务端没有查询端点，其它 agent 拿不到 |
| 卡片 / 表格 / 选项 / 状态组件 | 只有 Figma 设计件 + 零星 React（`ActionRow.tsx`）；没有数据驱动渲染器 |
| 受控组件嵌套与渲染器 | 基本没有 |
| 动作调度和用户审批 | 有 `ActionRow` 苗头，未联调审批流 |
| 多 Agent 协作 UI | 没有（房间是单 agent 模型） |

## 一句话
v0.1 的**功能体**基本齐了，卡在「可靠性 + 三件硬验收」；v0.2 只有语义协议这一块地基，渲染器/审批/多 agent 全没动。
按现在的节奏，先把 ①⑤ 收干净再说 v0.2，别两头开工。

