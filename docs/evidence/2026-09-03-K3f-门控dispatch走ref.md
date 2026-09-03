# K3f · 首屏门控的 dispatch 走导航容器 ref

日期：2026-09-03
基线：`kuca/mobile-patches` @ `ee3af1b9a`（已含 K3b + K3c + K3d + K3e）

本车道不打包、不装机、不碰手机。真机「apply 发出去了、JS 仍停在 Home」来自任务书已核实的 `gate-*` 记录。

## 要的结果、本轮不做

要的结果：冷启动时门控用和 `open-web` 同一条导航容器 ref 把根栈 reset 成 `CardsHome`。ref 还没 ready 就等，不能把这次 reset 丢掉。reset 之后立刻再写一条 `after_dispatch` 记录，里面是 `getRootState()` 当时的 `routeNames` 和 `index`。

本轮不做：打包、装机、改 S1/S2、把门控从 layout 挪到 Home 屏内部。

## 为什么 `useNavigation()` 在 layout 里 dispatch 不到根栈

`FirstScreenGate` 挂在 `apps/mobile/src/Stack.tsx` 的 `layout: RootStackLayout` 里。

静态导航把这个 layout 当成普通函数来调，不是 `createElement`。坐标：

- `apps/mobile/node_modules/@react-navigation/native/src/createStaticNavigation.tsx` 100–104：返回组件是 `<NavigationContainer ref={ref}><Component /></NavigationContainer>`。`ref` 就是 `App.tsx` 挂上的 `automationNavigationRef`。
- `@react-navigation/core@7.21.2` `src/useNavigationBuilder.tsx` 1001–1010：`layout({ state, descriptors, navigation, children })`。这里的 `navigation` 才是根 stack 自己的 helpers。
- 同文件 1012–1022：layout 包在 `NavigationHelpersContext` 里，**没有** `NavigationContext`。
- `@react-navigation/core@7.21.2` `src/useComponent.tsx` 10–12、26–36：`NavigationContent` 直接 `render(children)`，所以 `RootStackLayout` 的 hooks 跑在这层，不跑在某个 screen 里。

`useNavigation()` 读的是 screen 的 `NavigationContext`，没有才退回容器 ref：

```
// @react-navigation/core@7.21.2 src/useNavigation.tsx 18–28
const root = React.useContext(NavigationContainerRefContext);
const navigation = React.useContext(NavigationContext);
return (navigation ?? root);
```

`NavigationContext` 只在 screen 的 `NavigationProvider` 里提供（同包 `src/NavigationProvider.tsx` 41–47）。layout 在 screen 外面，所以这里拿到的是容器对象，不是根 stack 那份 `layout({ navigation })`。

`RootStackLayout` 的参数类型只写了 `{ children, state }`，把 stack 自己的 `navigation` 丢掉了。门控之前调的是这份容器对象上的 `dispatch(CommonActions.reset(...))`。

容器的 `dispatch` 和 `resetRoot` 不是一回事。坐标：`@react-navigation/core@7.21.2` `src/BaseNavigationContainer.tsx`

- 125–137：`dispatch` 把 action 交给 `listeners.focus[0]`，**不带 `target`**。焦点监听还没挂上时打印 `NOT_INITIALIZED_ERROR` 然后返回。
- 155–169：`resetRoot` 同样走 `listeners.focus[0]`，但会加上 `target: keyedListeners.getState.root().key`，强制打到根导航器。
- 188：`isReady()` 就是 `listeners.focus[0] != null`。

焦点监听是父组件的 `useEffect` 才注册的：同包 `src/useFocusedListenersChildrenAdapter.tsx` 44–47。根 state 的 keyed listener 也是 `useEffect`：`src/useOnGetState.tsx` 42–44。

React 先跑子树的 effect，再跑父组件。`FirstScreenGate` 是导航器的孩子。它第一次 effect 跑到的时候，父组件还没注册 focus listener，`isReady()` 是 false。这时 `dispatch(reset)` 被丢掉。状态不变，所以不会有第二条 gate 记录。这和真机「只有一条 `apply` / `untouched_home` / `willDispatch: true`，之后 `report` 仍是 Home」对得上。

同一进程里 `open-web` 能生效，是因为它先 `waitForNavigation()` 等到 `automationNavigationRef.isReady()`，再用同一份 ref 的 `navigate`。

## 为什么选 `resetRoot`，不选 `dispatch(CommonActions.reset)`

两条都会打到容器。差别是 `target`。

`dispatch(reset)` 没有 `target`，先交给当前焦点导航器。`BaseRouter` 的 `RESET`（同系列 `@react-navigation/routers@7.6.0` `src/BaseRouter.tsx` 45–76）只要 `routes[].name` 都在这份导航器的 `routeNames` 里就当作已处理。嵌套栈如果先接住，根栈不会被改。

`resetRoot` 把 `target` 设成根导航器的 key。`useOnAction`（core `src/useOnAction.tsx` 82–92）看到 `target !== state.key` 就跳过当前层，往上冒，直到根。这才是「换掉启动栈」要的动作。

`open-web` 的 `navigate("Web")` 也能走同一份 ref，是因为 `NAVIGATE` 在当前层没有这个名字时会冒泡。`RESET` 不会。所以这里用 `resetRoot`，不用再 `dispatch(reset)`。

ref 名字仍是 `automationNavigationRef`。它已经挂在 `App.tsx` 的 `<Navigation ref={...} />` 上，改名只是换标识符，不是换对象。

## 改法

1. 判定仍用 K3c / K3e 的纯函数。入站标记优先、开关关掉回 Home、`["Home","Thread"]` 迟到恢复接管、目标仍是 `CardsHome`。
2. `willDispatch` 为真时不再 `useNavigation().dispatch`。
3. `subscribeWhenReady`：`isReady()` 已真就立刻做；否则听容器的 `ready` 事件。effect 清理时取消等待，避免卸载后还 reset。
4. ready 之后 `automationNavigationRef.resetRoot({ index: 0, routes: [{ name: "CardsHome", params: { path: "/phone-cards" } }] })`。
5. 立刻再写一条 gate 记录，`reason: "after_dispatch"`，`routeNames` / `index` 来自 `getRootState()` 的 **routes**（栈里实际有哪些屏），不是导航器注册表上的 `routeNames`。`getRootState()` 为空时记 `routeNames: []`、`index: -1`，避免空集被读成成功。

停点没有触发。源码上 `resetRoot` 在 ready 之后会带根 key；缺的是第一次 effect 时还没 ready。等 ready 就能打到根，不需要把门控挪进 Home 屏。

## 改了哪些文件

| 文件 | 做什么 |
| --- | --- |
| `apps/mobile/src/features/home/firstScreen.ts` | `resetRoot` 载荷、根状态快照、`after_dispatch` 记录、`subscribeWhenReady` |
| `apps/mobile/src/features/home/FirstScreenGate.tsx` | 等容器 ref ready，再 `resetRoot`，再写 `after_dispatch` |
| `apps/mobile/src/features/home/firstScreen.test.ts` | 先写断言再写实现 |
| `docs/evidence/2026-09-03-K3f-门控dispatch走ref.md` | 本报告 |

K3c / K3e 判定没动。`describeFirstScreenDecision` 的 7 个 reason 仍是原来那些。`after_dispatch` 只出现在 dispatch 之后那条记录上。

主线打包装机后，冷启动 20 秒应看到：

1. 一条 `apply` / `untouched_home` / `willDispatch: true` / `routeNames: ["Home"]`
2. 一条 `after_dispatch` / `willDispatch: false` / `routeNames: ["CardsHome"]`
3. `report` 的 `route.name` 为 `CardsHome`

如果第 2 条是 `routeNames: ["Home"]` 或 `[]`，reset 仍没改到 JS 状态，这条路也到不了，再考虑把门控挪进 Home 屏。

## 红 → 绿

命令：`./node_modules/.bin/vp test run --exclude 'task/**' apps/mobile/src/features/home/firstScreen.test.ts`

红（测试已加上，实现还没有）：

```
 ❯ apps/mobile/src/features/home/firstScreen.test.ts (29 tests | 10 failed) 7ms
     × resets the container root to CardsHome with the stream path
     × resets the container root to Home when cards-first is off
     × reads the live stack from routes, not the registered routeNames table
     × marks a missing root as empty so a failed reset is not a fake 100%
     × is the host-pullable follow-up: reason after_dispatch, willDispatch false
     × records an empty stack when getRootState had nothing
     × runs onReady now when the container is already ready
     × waits for the ready event and does not drop the callback
     × runs onReady once if the container becomes ready between the check and the listener
     × does not run onReady after unsubscribe

 Test Files  1 failed (1)
      Tests  10 failed | 19 passed (29)
   Start at  16:04:58
   Duration  507ms
```

失败都是 `TypeError: … is not a function`。旧的 19 条判定用例仍绿。

绿（补上四个纯函数）：

```
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Start at  16:06:14
   Duration  534ms
```

## 验证块（本车道实跑）

```
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
./node_modules/.bin/vp test run --exclude 'task/**' apps/mobile/src/features/home
```

退出码 0。

```
 Test Files  6 passed (6)
      Tests  63 passed (63)
   Start at  16:06:22
   Duration  2.72s
```

```
cd apps/mobile && ../../node_modules/.bin/tsc --noEmit
```

退出码 0。无输出。

真机冷启动 20 秒：本车道按任务书不打包、不装机，未跑。
