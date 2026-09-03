# S2 — App 把服务端的类型化错误解码成了不透明的 schema issue

## TL;DR

服务端在 `thread.turn.start` 上返回一个带 `message` 的类型化错误（W6 那种 `T3RemoteWsRpcError`），App 拿到的却是
`Expected "ThreadNotFound", got "T3RemoteWsRpcError" ...` 这类 schema 校验噪声——真正的原因（"Thread … 已被隐藏或不存在"）被丢了。

根因在 Effect RPC 的响应解码层：客户端声明的错误联合类型不含服务端那个 tag，解码 `Exit` 失败被 `Effect.orDie` 塌成
一个包着 `SchemaError` 的 defect；原始服务端帧只剩在 `SchemaError.issue` 的 `actual` 里。修复在客户端把这帧从 `actual`
里挖回来取 `message`，接进三个用户可见出口；同时把发件箱对服务端拒绝的处理从"静默丢弃"改成"停队 + 显示原因 + 可重试"。

- 单测先红后绿：见文末「红→绿证据」。
- 验收门禁：`tsc --noEmit` = 0 错误；两个测试文件 25 passed。

---

## 1. 根因定位（要我在两层里选一层）

结论：**丢信息的是第 1 层——RPC `Exit` schema 只承认 T3 自己声明的错误联合类型；`settleAsyncResult` 是清白的，它原样带着 cause。**

链路（从服务端一帧到 UI）：

1. **解码入口 / 丢 tag 的地方** — `node_modules/.../effect/dist/unstable/rpc/RpcClient.js:455`

   ```js
   decodeExit: Schema.decodeUnknownEffect(Schema.toCodecJson(Rpc.exitSchema(rpc)));
   ```

   `Rpc.exitSchema(rpc)` 造的 `Exit` schema，其错误通道只收该 RPC 声明的错误联合。服务端回一个不在这个联合里的
   `T3RemoteWsRpcError`，这一步 `decodeUnknown` 直接失败，抛出一个真正的 `SchemaError`（`instanceof Error === true`）。
   **原始服务端帧此时只活在 `SchemaError.issue` 的 `actual` 里。**

2. **SchemaError 被塌成 Die** — `RpcClient.js:404`

   ```js
   entry.schemas.decodeExit(message.exit).pipe(..., Effect.orDie, Effect.matchCauseEffect({ onFailure: cause => ... Exit.failCause(cause) }))
   ```

   `Effect.orDie` 把解码的 `SchemaError`（一个 typed failure）转成 defect；随后 `onFailure` 把它写成
   `Exit.failCause(Cause.die(SchemaError))`。也就是说 Die 是在 RpcClient 里生的，不是客户端 runtime 干的。

3. **客户端 runtime（不是罪魁）** — `packages/client-runtime/src/state/runtime.ts:309` `settleAsyncResult`

   ```ts
   return AsyncResult.fromExit(await execute()); // Fail 原样保留
   ```

   `execute()` 走 `Effect.runPromiseExit`，拿到的是 `Exit.failCause(Die(SchemaError))`，`fromExit` 忠实地把这条 cause 带出来。
   只有当 promise 真的 reject（同步抛）时它才 `Cause.die`（314-315）。所以 brief 里的第二种猜测
   （"`settleAsyncResult` 把 Fail 当 Die"）**不是本 bug 的机制**——到这里信息已经因为第 1、2 层丢了。

4. **App 读出的是 schema 文本** — 改前的消费点，例如 `apps/mobile/src/state/query.ts` 的 `formatError` 与各调用方都写
   `error instanceof Error ? error.message : null`。`Cause.squash(Die(SchemaError)) === SchemaError`，于是
   `.message` 取到的是那句 `Expected "ThreadNotFound", got "T3RemoteWsRpcError"\n  at ["_tag"]`。这句话里既没有服务端原句，
   也没有 `INTERNAL_ERROR_IDENTIFIER` 那种 `a.b/c` 形态，`presentUserFacingError` 不拦它，于是 schema 内部细节原样漏到 UI。

**实证**：用一个"只承认 `ThreadNotFound`"的 schema 去解 W6 那种原始帧，`try/catch` 拿到 `SchemaError`，
`SchemaIssue.getActual(err.issue)` 正好等号那帧原始数据、其 `.message` 就是服务端原句；而 `err.message` 是上面那句 schema 噪声。
（同 `userFacingError.test.ts` 里 `decodeServerFrameAgainstClientOnlySchema()` 的做法。）

---

## 2. 改动清单

### 2.1 从 `actual` 里把服务端原句挖回来（核心）

`apps/mobile/src/lib/userFacingError.ts:46` 新增 `describeServerError(value: unknown): string | null`

- 字符串 → trim 原样；
- 命中 `SchemaError.isSchemaError(value)` → `firstServerMessage(SchemaIssue.getActual(value.issue))`，即在解码失败的 `actual`
  里递归找第一个非空 `message`（`MAX_ERROR_SCAN_DEPTH = 8` 只做防自引用/超深护栏，不是防真实数据）；
- 其它对象 → 递归找 `.message`。

`apps/mobile/src/lib/userFacingError.ts:60` 新增 `describeCauseMessage(cause)` = `describeServerError(Cause.squash(cause))`，
给已经 settled 的命令 cause 用。`presentUserFacingError`（过滤内部标识符 + 兜底文案）保持不变，继续做最后一道屏。

### 2.2 三个用户可见出口接上

- 环境查询错误：`apps/mobile/src/state/query.ts:18` `formatError` 改为
  `presentUserFacingError(describeCauseMessage(cause), "The environment request failed.")`。
- 配对 / `pendingConnectionError`：`apps/mobile/src/state/use-remote-environment-registry.ts:164` `onConnectPress` 的
  `error instanceof Error ? error.message : null` 换成 `describeServerError(Cause.squash(result.cause))`。
- 发件箱失败原因：见 2.3，落库与横幅都用 `describeCauseMessage`。

### 2.3 发件箱不再静默丢弃服务端拒绝（W5）

`apps/mobile/src/state/thread-outbox-model.ts`

- `QueuedThreadMessage` 增加可选 `failureReason`（schema `thread-outbox-model.ts:56` `Schema.optional(Schema.String)`；
  接口 `:84`）。**可选字段，旧持久化消息照常解码，不需 schema 版本迁移。**
- 决定动作类型 `thread-outbox-model.ts:223` 从 `"retry" | "discard"` 改为 `"retry" | "fail"`；
  `resolveThreadOutboxFailureAction`（`:225`）对 start-turn 上的确定性（非传输、非中断）服务端拒绝返回 `"fail"`。

`apps/mobile/src/state/use-thread-outbox-drain.ts`

- 投递结果三态 `ThreadOutboxDeliveryOutcome = "delivered" | "retry" | "failed"`（`:64`）。旧代码用 `true/false` 布尔，把
  "服务端明确拒绝"和"瞬时可重试"混成了一个 `false`。
- `reportFailure`（`:134`）返回 `"success" | "retry" | "fail"`；命中 `"fail"` 时（`:164-173`）：
  ```ts
  const reason = presentUserFacingError(
    describeCauseMessage(commandResult.cause),
    "The environment rejected this message.",
  );
  void updateThreadOutboxMessage({ ...queuedMessage, failureReason: reason }); // 保留在队里，带原因
  setPendingConnectionError(reason); // 立刻可见
  ```
  ——不 `remove`，用户的这一轮不会凭空消失。
- 主循环 parked 护栏（`:337`）：`if (nextQueuedMessage.failureReason !== undefined) continue;`，被停队的消息不再每轮回灌
  服务端；外层 `.then((outcome) => …)`（`:450`）里 `"retry"` 才排退避定时器，`"failed" / "delivered"` 清退避状态。
- 解除停放：编辑或重排这条消息（`buildPendingTaskMessage` / composer 入队产出的新对象不带 `failureReason`）即清空原因、重新武装；删除则整条移除。

### 2.4 测试

- 改 `apps/mobile/src/state/thread-outbox.test.ts`：`"discard"` 断言 → `"fail"`（含注释说明为什么不能丢弃），测用例改名。
- 加 `apps/mobile/src/lib/userFacingError.test.ts`：W6 原始帧经"只承认自家 tag"的 schema 解出真 `SchemaError` →
  断言 `describeServerError` / `describeCauseMessage` 得到服务端原句；并显式断言旧的 `.message` 路径拿不到那句（锁住回归）。

---

## 3. 红→绿证据

命令（本包 `"test": "vp test run"`，`vp`=vite-plus 的 vitest 封装，运行时 `RUN v4.1.9`；等价于 brief 说的
`pnpm exec vitest run <test>`——仓库里没有独立的 `vitest` 可执行文件）。

### 红（临时把 `describeServerError` 的 SchemaError 分支退回改前"读 `.message`"的行为后运行）

```
 ❯ apps/mobile/src/lib/userFacingError.test.ts (6 tests | 2 failed)
   × delivers the server's sentence to the UI when the RPC Exit decode fails
   × recovers the server's sentence from a settled command Cause
 AssertionError: expected 'Expected "ThreadNotFound", got "T3Rem…' to be 'Thread 01JHIDDEN cannot accept a mess…'
 - Thread 01JHIDDEN cannot accept a message because it is hidden or no longer exists.   // 期望=服务端原句
 + Expected "ThreadNotFound", got "T3RemoteWsRpcError"
 +   at ["_tag"]                                                                        // 改前 UI 实际拿到
```

（红证明：改前那层从 `SchemaError` 拿到的永远是 schema 噪声，不是服务端那句话。）

### 绿（恢复修复后运行两份测试）

```
 Test Files  2 passed (2)
      Tests  25 passed (25)
```

### 验收门禁

```
$ cd apps/mobile && pnpm exec tsc --noEmit
TSC_EXIT=0
```

---

## 4. 备注 / 需要服务端配合的部分（本任务未做）

- **更根治的做法**在契约层：让 `packages/contracts` 的 `WsRpcGroup` 各 RPC 声明的错误联合真正含 `T3RemoteWsRpcError`
  （或把它映射成一个带 `message` 的客户端已知 typed error）。那样第 1 步 `decodeUnknown` 直接成功，根本不用从 `actual` 里挖。
  这需要动 contracts + 可能动服务端，属"需要服务端配合"，且越出"只修 App、不动服务端"的禁区，**本任务未做**。当前客户端修复不依赖它即可生效。
- pending-task 行上尚未给已停队的消息挂一个显式 "Failed" 徽标（低优先，本轮以横幅 `pendingConnectionError` + 队列计数保证可见性）；
  若要更强的逐条可见性，下一步可把 `failureReason` 渲到该条 pending 行上。
