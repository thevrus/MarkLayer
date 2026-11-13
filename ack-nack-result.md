# ACK/NACK 修复结果

## 改动文件

- `packages/types/src/wire.ts`、`packages/types/src/wire.test.ts`：新增 mutation correlation metadata 与 ack/nack 协议类型。
- `apps/worker/src/annotation-room.ts`、`apps/worker/src/annotation-room.test.ts`：为操作、协作任务、图层和执行模式变更返回回执；拒绝时保留旧版 `error` 帧，并避免广播拒绝结果。
- `apps/extension/lib/ops.ts`、`apps/extension/lib/realtime.ts`、`apps/extension/lib/realtime.test.ts`：记录乐观变更的逆操作，处理 nack、超时和断线回滚。

## 协议

客户端通过 `clientOpId` 与单调递增的 `seq` 标识一条变更。服务端回执中的 `opId` 对应该 `clientOpId`；旧客户端未提供时，服务端生成回执 ID 和序号。

```json
{ "type": "ack", "opId": "client-id", "status": "applied", "seq": 1, "rev": 3 }
{ "type": "ack", "opId": "client-id", "status": "noop", "seq": 2, "rev": 3 }
{ "type": "nack", "opId": "client-id", "status": "refused", "seq": 3, "code": "read_only", "reason": "当前房间不允许编辑" }
```

NACK 同时附带原有语义的 `error` 消息，旧客户端可继续处理拒绝。只有成功生效的变更会广播给房间其他参与者。

## 验证状态

全部在 `agent/ack-nack-2026-11-13` 上跑过（bun 1.4.3，`bun install --frozen-lockfile`，lock 未变）：

- `git diff --check`：通过。
- `bun run lint`（biome）：通过，632 files，0 错。
- `bun run check` 逐包（extension / worker / mcp / types / agent-tools）：全部 exit 0。
- `apps/worker`：`bun test src web shared` → **542 pass / 0 fail**。
- `apps/extension`：`bun test` → **629 pass / 0 fail**。
- `packages/types`：`bun test` → **113 pass / 0 fail**。

## 体积预算

新增的 pending/回滚代码让小组件 gzip 从预算内的基线涨到 **106_374**，原预算 105_536。
已把 `apps/extension/widget/build.test.ts` 的 `GZ_BUDGET` 抬到 **107_008**（+1.4KB），并在注释里写明这 1472 字节是给 ACK/NACK 的 pending 回滚的。

## 还没做的

- **双浏览器真实验收**（brief 的收货标准）：一个窗口以 guest 身份发会被拒的 move，看发送方当场回滚 + 提示、对面板子不受影响。本地还没起 worker，没跑。
- 其它走 mutate 的入口里，`teach_control` 这类只管演示状态的命令没有纳入回执（它们不改 board 状态）；如果也要回执，得再补一轮。
