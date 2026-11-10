# PC 网页验收记录（2026-11-10）

## 环境和范围

- 本机 Windows，桌面浏览器，窗口约 1028×862；本地 Wrangler 与 D1，地址 `127.0.0.1:5173`。
- 以两个隔离浏览器会话加入同一个本地房间；页面目标为 Example Domain。所有鼠标点击和拖动均直接作用于实际网页。
- 未部署 Cloudflare 远端。迁移命令使用 `--local`，其输出列出 0001–0014 全部成功；运行进程在显示完成后未退出，随后手动停止。重启后房间的 `exec_mode` 可从本地 API 读回。

## 已操作并观察

1. 选择画笔、拖动绘制；选择矩形、拖动框选；用图钉创建问题。刷新后页面信息显示一笔画、一个矩形，问题仍存在。见 `pen-rectangle.png`。
2. 人类从工具栏进入演示，点击页面元素选择目标，输入讲解，发送两步。两个会话都收到字幕；观看者点下一步后，双方显示第二步。观看者关闭后演示者仍可见；演示者可结束。
3. 人类演示的上一步、下一步、暂停、继续、关闭、重新打开和结束均已点击并观察到状态变化。目标高亮和字幕见 `teach-human.png`、`teach-two-step.png`。
4. 房间切到 Guide 后，另一个独立会话读取到 Guide；MCP 创建批注、确认接手及回复成功，resolve、dismiss、suggest_edit 返回拒绝。网页中的问题仍为 Open 并显示 Agent 回复，见 `guide-question.png`。
5. 切到 Pair 后，相同批注的 MCP resolve 成功；网页中人类点击 Approve 后状态变为 Approved。
6. Agent 调用 `teach_step` 并指定批注 ID，网页显示目标高亮与字幕，见 `agent-annotation-target.png`。网页点击下一步后，正在等待的 `marklayer_watch_annotations` 实际收到 `teach_control` 的 `next`。
7. 发现批注侧栏盖住工具栏右侧，修正工具栏层级后，在侧栏打开时点击“演示”可打开创建面板，见 `toolbar-with-panel.png`。
8. Agent 的 approved 限制由服务端房间测试覆盖；网页人类批准已实操。没有通过伪造其他客户端协议验证身份冒充场景。

## 自动验证

- 最后一次 `bun run test`：12/12 任务成功；其中 extension 574 项、worker 526 项通过（Turbo 对未变化的任务使用缓存）。
- `bun run check`：12/12 任务成功；Astro 检查 0 error、0 warning。
- 最后一次 `bun run build`：6/6 任务成功。一次构建在 Wrangler 运行时遇到 Windows 文件占用，停止本地服务后重跑成功。
- 测试使用本机 Bun 1.4.3；原方案指定版本 1.3.14 在 Windows 的上游 WebSocket 关闭用例曾超时，因此不声称该版本完整测试通过。

## 已知体验建议

- 批注详情侧栏打开时会遮住页面右侧的一部分，高亮框也会被侧栏遮挡；可以后续在展示目标前收起侧栏或滚动/平移目标到可见区。
- 演示控件已能操作，但按钮视觉层次较轻；可在后续统一到项目的按钮样式，并补充键盘操作和更复杂视口下的布局验收。
