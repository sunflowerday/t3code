# KUCA S1（原 L10）· 服务端重启后 App 发件箱 wait 不重试

日期：2026-09-03 · 车道：task/20260903-051749-S1-… · base：8a54fa71e

## 一句话

App 侧能修的那一半修了：`wait` 现在自己带一个 15 秒兜底重评估，不再单纯等别的 atom 变动。
但**只靠这个补不上真机那条验收**——重启后客户端 store 里的 shell 快照压根没动过，重评估每次都读到同一份 stale 数据。
要闭环得改 `packages/client-runtime/src/rpc/client.ts:236-247`（订阅丢了传输以后既不重试也不报错）。**服务端经核对不用改。**

## 1. 复现序列（真机 2026-09-03 03:35 / 03:39，主线已核实，这里不重查）

1. 3773 重启，App 自动重连。
2. `automation send` 深链入队一条消息。
3. 唯一一条投递报告：`deliveryAction=wait, shellStatus=synchronizing, connectionState=connected, threadSessionStatus=starting`。
4. 之后 3 分钟**没有任何** outbox-delivery 报告；服务端 `projection_thread_sessions.status` 一直是 `ready`。
5. 强杀重开 App：两条 `wait`（synchronizing/starting）→ 一条 `send`（live/ready）→ 回合落库。

### 我从代码上补的一环推断

`automationNote` 每条 note 写一个独立文件（`note-<毫秒>-report.json`，`apps/mobile/src/features/automation/automationLink.ts:96-101`），
而且 note 打在 `deliveryAction` 判定**之后**、`wait` 分支**之前**（`use-thread-outbox-drain.ts:329-341`）。
所以「drain 重跑了但还是 wait」也会留下文件。3 分钟 0 文件 ⇒ effect 一次都没再执行 ⇒ 它依赖的 `threads` / `shellStatuses` 恒等地没变过。
冻结点不在决策逻辑里，在决策的输入上。

## 2. 钉根因：store 层复现（不依赖 expo）

新增 `apps/mobile/src/state/use-thread-outbox-drain.test.ts`，用一个真实的 `AtomRegistry` + 真实的
`createEnvironmentThreadShellAtoms`（`packages/client-runtime/src/state/threadShell.ts`）驱动原子变化序列：
快照里 session `starting` → drain 输入 `wait`；把快照换成 `ready` → 断言 `threadShellsAtom` 的**数组引用变了**。

结论：**只要 store 真变了，drain 一定看得见**（`threadShellsAtom` 用 `arrayElementsEqual` 按引用比较，
新快照必然产生新对象引用 → 依赖翻转 → effect 重跑）。这条被单测正面证明了，
所以 03:35 的静默只可能是「store 没变」，不是「变了但 React 没接住」。

## 3. store 为什么没变（真正的根因，在共享包里）

- `packages/client-runtime/src/state/shell.ts:110-118`：`setReady` 名字叫 ready，实际写的是 `synchronizing`（除非已经 `live`）。
  翻成 `live` 只有两条路：收到 `synchronized` marker（`:138-145`），或在 `awaitingCompletion=false` 时收到任一 item（`:166`）。
- `packages/client-runtime/src/rpc/client.ts:236-247`：**传输失败分支只打一条 warning 然后 `Stream.drain`**——不重试、
  也不走 `onExpectedFailure`，所以 shell state 的 `error` 保持 `none`、`status` 保持 `synchronizing`，
  只能等「下一次 session 变动」来救（`switchMap`，`:202`）。如果重连的那次 session 变动恰好就是触发本次订阅的那一次，
  就再也没有下一次了 → 订阅永久停在半路，快照停在重启前那份（于是 session 还是 `starting`）。
  隔壁的非传输失败分支（`:248-262`）是有 `retryExpectedFailureAfter` 的——这个洞就是少了对称的那一半。
- 重开 App 能好：`shell.ts:204-211` 的 HTTP 快照是**无条件覆盖**（`kind:"snapshot"` 不过 sequence 闸门），
  一次性把 `live` + `ready` 都带回来。

## 4. 服务端核对：不用改

`apps/server/src/ws.ts:1129-1235` + `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:197-219`：

- `snapshotSequence` = 7 个 projector 的 `min(lastAppliedSequence)`，读自 `projection_state` 行，**重启不清零**；
  event `sequence` 是 SQLite autoincrement，单调。客户端游标和服务端头来自同一公式，重启后 gap=0。
- `replayGap` 不在 `[0, 1000]` 内 → 直接下发**全量快照** + marker（`ws.ts:1200-1205`）；新订阅无 `afterSequence` →
  第一帧就是全量快照（`ws.ts:1225-1232`）。`shellResumeCompletionMarker` 服务端是声明的（`ws.ts:1010`），marker 每条路径都发。
- DB 里 `ready` 躺着，说明真相一直在服务端可取，只是客户端没再来取。

所以主线不用去改 synara 的投影/快照；要改的是客户端订阅的自愈。（以上是代码核对，不是对 3773 的活体测量。）

## 5. 改了什么

**`apps/mobile/src/state/thread-outbox-model.ts`**（新增纯核，`resolveThreadOutboxDeliveryAction` 原样保留、仍是它内部调用）

- `THREAD_OUTBOX_WAIT_RETRY_DELAY_MS = 15_000`
- `resolveThreadOutboxDrainEvaluation(...)` → `{ deliveryAction, waitRetryDelayMs, report }`：
  把「判定 + 判定被什么挡住 + 要不要再叫醒自己」收进一个不依赖 React/expo 的函数，报告载荷也从这里出，
  保证「报告说的」和「据以决策的」是同一份数。
- `isThreadOutboxSessionBusy(status)`：busy 的定义单一来源（原来是两处手写 `running||starting`）。

**`apps/mobile/src/state/use-thread-outbox-drain.ts`**

- `wait` 分支（`:354-360`）：`armWaitReEvaluation(...)` 以后才 `continue`。复用 `retryTimersRef`，
  所以成功投递时原有清理逻辑顺手把它清了，卸载清理也覆盖它，且同一消息不会叠表。
- **同一个洞的第二半**：确认写落库期间线程变 busy 而**延后**的那条 `send`（`:416-425`）原来 `return true`，
  等于「已处理」，把定时器和计数一起清干净、然后躺平。现在延后也 arm 一次。
- 依赖数组补 `armWaitReEvaluation`，并给 `threads` / `shellStatuses` 写了注释：它们就是「状态一变立刻重评估」的机制本体，
  `retryTick` 是状态变化传不到本机时的兜底。
- 报告字段一字未改（`deliveryAction/isCreation/threadExists/shellStatus/connectionState/threadSessionStatus`），
  主线还能按老字段 grep。自动化钩子（`automationLink.ts`）一个字没动。

## 6. 装机验收会看到什么（这一条请当判别实验做）

按老步骤：重启 3773 → App 重连 → `send` 深链 → 等 60 秒看 `projection_turns`。

- 若 60 秒内多一条 `projection_turns`：说明重评估 + 迟到的状态变化就够用，本改动直接达成验收。
- 若**每 15 秒多一条 `outbox-delivery`（全是 `wait`，输入仍是 `synchronizing`/`starting`）**：
  这恰好正面坐实第 3 节——兜底在跑，但客户端的快照是冻的。这条改动让故障从「永远躺着、无声无息」
  变成「每 15 秒喊一次并且把卡在哪写清楚」，**但它本身不会让这条消息发出去**。此时去修 `client.ts:236-247`。

**明确说不保证的部分**：「60 秒内落库、不重开 App」这一条，在只改发件箱 drain 的前提下达不到——因为决定 `send`/`wait`
的输入源本身冻住了。要真闭环，二选一（都超出本次授权，等你拍）：

1. **真修**：`client.ts` 的 transport 分支给它隔壁同款的 `retryExpectedFailureAfter` 重订阅。
   影响面是 web/desktop/mobile 全部订阅——收益是所有「重连后页面停在旧数据」的类别，不只发件箱。
2. **App 侧一次性自救**：消息卡在 `wait` 且该环境 shell 不是 `live` 时，
   `appAtomRegistry.refresh(environmentShell.stateAtom(environmentId))` 一次（先例：
   `apps/mobile/src/features/archive/useArchivedThreadSnapshots.ts:26`）。
   代价是这个 atom 从 `initialValue` 重启，线程列表会闪一下空；且必须限成「每次卡顿只来一发」，
   否则会把一个合法耗时 >15 秒的同步反复打断——这也是我没未经确认就动手的原因。

顺带一个可测预测（**未实测**）：短暂切后台再回前台（<10 秒 → `application-active-probe`，
`apps/mobile/src/connection/app-state-wakeups.ts:14-20`）会命中 `shouldResubscribeAfterWakeup`
（`packages/client-runtime/src/connection/wakeups.ts:19-21` → `shell.ts:172-176`）触发重订阅，
理论上**不重开 App** 也能恢复。后台超过 10 秒走的是 `application-active-reconnect`，不在重订阅白名单里。

## 7. 红 → 绿原文

红：同一份测试文件，`git checkout` 掉两个源文件（回到 base 8a54fa71e 的 pre-fix 代码）后运行。
pre-fix 代码里根本没有「wait 要自我重评估」这个概念，红表现为导出不存在：

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  apps/mobile/src/state/use-thread-outbox-drain.test.ts > thread outbox drain re-evaluation > arms a bounded re-evaluation for a message the pass decided to wait on
TypeError: resolveThreadOutboxDrainEvaluation is not a function
 FAIL  … > still arms a re-evaluation while a real turn keeps the thread busy
TypeError: resolveThreadOutboxDrainEvaluation is not a function
 FAIL  … > reports the inputs that blocked delivery
TypeError: resolveThreadOutboxDrainEvaluation is not a function
 FAIL  … > sends on the first pass where the shell is live and the session is ready
TypeError: resolveThreadOutboxDrainEvaluation is not a function
 FAIL  … > waits for a thread that is not in the loaded shell list until the shell is live
TypeError: resolveThreadOutboxDrainEvaluation is not a function
 FAIL  apps/mobile/src/state/use-thread-outbox-drain.test.ts > thread outbox drain store inputs > re-evaluates from changed thread shells when a session status moves in the store
TypeError: resolveThreadOutboxDrainEvaluation is not a function

 Test Files  1 failed (1)
      Tests  6 failed (6)
```

（6 条全红都是同一个原因，上面是精简版；完整 94 行原样存在 `/tmp/kuca-s1-red.txt`。）

绿（改完 + 重放 patch）：

```text
 RUN  v4.1.9 /Users/yee/Documents/agent/tooling/t3code/task/20260903-051749-S1-原-L10-服务端重启后-App-发件箱-1

 Test Files  8 passed (8)
      Tests  52 passed (52)
   Start at  05:35:03
   Duration  1.29s (transform 2.35s, setup 0ms, import 5.81s, tests 64ms, environment 0ms)
```

```text
$ cd apps/mobile && pnpm exec tsc --noEmit
TSC_EXIT=0
$ node_modules/.bin/vp lint <三个改动文件>
LINT_EXIT=0
```

新增 6 条（`apps/mobile/src/state` 全目录 52 条 = 原 46 + 新 6，无回归）。

最终复核（05:39，工作区就是现在这三个改动）：单跑新文件 `6 passed (6)`，全目录 `8 files / 52 tests passed`，
`pnpm exec tsc --noEmit` 与 `vp lint` 均为 0。

**单测证到哪一步，说清楚**：单测证的是判定核（含「wait 必须带兜底重评估」这条新契约）、
报告载荷字段、以及 store 传播。**没证到** React 里那个 `setTimeout` 真的会响——那是第 6 节装机验收要判的事。

## 8. 环境与禁区

- 本 worktree 起跑时**没有 node_modules**（base 的 3 个未提交条目里应该带着它）。我执行了
  `pnpm install --frozen-lockfile --prefer-offline`：`pnpm-lock.yaml` 未被改写（frozen 保证），未走上层树/主树。
- 主线给的验收命令 `pnpm exec vitest run <file>` 在本 worktree 根目录**跑不起来**（vitest 没有被暴露成根 bin）：

  ```text
  $ pnpm exec vitest --version
  [ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "vitest" not found
  ```

  等价替代是仓库自己的 runner（内部就是 vitest 4.1.9）：

  ```text
  $ node_modules/.bin/vp test run apps/mobile/src/state/use-thread-outbox-drain.test.ts
  $ node_modules/.bin/vp test run apps/mobile/src/state
  ```

  没有运行任何会触发安装的 package 脚本。

- 没打包、没装机、没碰 `ios/`、没改 `node_modules` 内容、没改 `pnpm-lock.yaml`、没改自动化钩子。
- 改动仅 3 个文件：`thread-outbox-model.ts`、`use-thread-outbox-drain.ts`、新增 `use-thread-outbox-drain.test.ts`，
  外加本报告。

## 9. 模型与载体

QoderCN。核对过：`resolveThreadOutboxDeliveryAction` 的既有语义与调用方一字未动（`thread-outbox.test.ts` 19 条原样通过）。
