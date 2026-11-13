# 任务:修 ACK/NACK —— 让被拒绝的协作变更回传到发送方(Visual Collaboration v0.1 发布门槛)

仓库:`D:\visual collaboration`(bun + turbo monorepo,Cloudflare Worker + Durable Object + React/Preact 客户端)
你只改仓库代码,**不要 push、不要合并主分支**,在独立分支上做完提交即可。

## 上一轮审计确认的问题(要修的就是这些)

1. **服务端**
   `apps/worker/src/annotation-room.ts` 里 `MutateOutcome = 'applied' | 'noop' | 'refused'`(第 121 行),
   `mutate()` / `mutateLocked()`(第 512 行起)其实已经能判三态。但 WebSocket 的人用路径把返回值丢了:
   第 ~1035 行 `else ws.send(JSON.stringify({ type: 'error', code: 'collaboration_change_refused' }))`,
   ~1065 行 `layer_change_refused` 同样写法 —— **发出的错误里没有 opId/seq,发送方无法知道是哪一条变更被拒**,
   成功(noop)时更是什么都不回。
2. **客户端**
   `apps/worker/web/AnnotationBoard.tsx`、`apps/worker/web/Viewer.tsx` 里的协作变更是 fire-and-forget + 本地乐观更新:
   先落本地状态再发出去,收到 `error` 消息时没有 opId 可对,无法回滚;
   组件里还有注释承认「guest 的 move 会先落本地、再被房间拒绝,板子就跟别人对不上」。

## 要做的

### 服务端
- 每条从 WS 收到的变更带一个客户端生成的 `opId`(以及可选的单调 `seq`);若客户端没带,服务端补一个并在回执里带回。
- 处理结果统一回一条回执消息,形如
  `{ type: 'ack', opId, status: 'applied' | 'noop', rev? }`
  `{ type: 'nack', opId, status: 'refused', code, reason? }`
  `code` 用现有语义(`collaboration_change_refused` / `layer_change_refused` / 锁、越权等分支各自的原因),
  不要吞掉具体拒绝原因。保持与现有 `error` 消息的向后兼容(旧客户端仍能通过 `error` 收到拒绝)。
- 覆盖 `annotation-room.ts` 里所有走 mutate 的入口(op / update_op / move / delete / lock 相关等),别只修一条。
- 房间里其它人仍然只收到「已生效」的广播,**不要**把被拒的变更广播出去。

### 客户端
- 发送时记到 pending 表里:`opId -> 乐观更新的回滚函数`。
- 收到 `nack`:回滚对应 opId 的本地状态,并给用户一条可见提示(现有 toast/提示风格),说明为什么没成。
- 收到 `ack` 且 `status: 'noop'`:把本地乐观更新视为已确认(不必回滚),但要清掉 pending。
- 超时(例如 15s 没有回执):视为未确认,回滚并提示「连接不稳,改动没同步上」,不要静默留在本地。
- 断线重连后 pending 全部作废并回滚(与服务器状态对齐)。

### 测试
- 服务端:单测覆盖 applied / noop / refused 三态各回什么消息、opId 是否原样带回、旧 `error` 兼容、被拒变更不外播。
- 客户端:至少覆盖「nack 触发回滚」「noop 清理 pending 不回滚」「超时回滚」三条。
- 跑通仓库已有的检查:`bun run test`、`bunx biome check`、`git diff --check`。

## 收货标准(我会照这条验)
- 两个浏览器窗口:一个以 guest 身份发一条会被拒的 move(例如锁住的层 / 越权操作),
  发送方**当场看到回滚 + 原因提示**,另一边板子不受影响、不同步错位。
- 正常编辑不受影响,没有额外延迟感。

## 不要做的
- 不要动 Figma 插件(`apps/figma-plugin`,另有人在改)。
- 不要改品牌/设计 token,不要顺手重构无关文件。
- 不要 push。
- 做完写一份 `ack-nack-result.md` 放在仓库根,内容:改了什么文件、协议消息最终形状、测试结果、还有哪些没覆盖。
