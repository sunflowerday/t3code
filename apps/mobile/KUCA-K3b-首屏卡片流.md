# K3b · Kuca iOS 首屏改为「最新卡片流」

基线 `8a54fa71e`，改动全部在 `apps/mobile/src`（外加本文件）。未打包、未装设备、未碰 `ios/`、`node_modules`、`pnpm-lock.yaml`，未改自动化钩子的动作集。

## 结论先说

- 首屏决策是一个纯函数模块，单测先红后绿（12 passed）。
- 开关落在 `mobile-preferences`，默认开；关掉之后设置页一改，下次冷启动回到旧的线程列表首屏。
- 自动化报告的 `route` 现在报 `{ name: "Web", params: { path: "/phone-cards" } }`，`automationLink.ts` 一行没动。
- 类型 0 错误。相邻单测 53 passed。有一个**先于本改动就存在的**失败套件，见最后一节。

## 为什么不是改 `initialRouteName`

`RootStack` 是静态配置（`createNativeStackNavigator` + `createStaticNavigation`）。四条路都被源码堵死，所以改成「启动后一次性接管」：

- `initialRouteName` 传不进去——`createStaticNavigation` 不给 navigator 传 props，它是静态的。
- `initialState` 会短路 linking，冷启动深链直接失效。
- 用 `if:` 条件注册 Home，等于把 Home 注销，「线程」按钮就找不到路由了。
- 单纯 `navigate` 会变成 `[Home, Web]`，卡片压在列表上，左上角只有回到列表的返回键，跟需求要的方向正好相反。

正确形状是：根路由换成 `Web(/phone-cards)`，线程列表**压在上面**。于是卡片右上角「线程」= 入栈列表，列表左上角原生返回 = 回卡片。

## 改动

**新增 `src/features/home/firstScreen.ts`（纯，零 import，参照 `automationUrl.ts` 的切分）**

- `PHONE_CARDS_PATH = "/phone-cards"`（与 K3a 的契约）
- `resolveCardsFirstScreenEnabled({preference, preferencesLoaded})` → 未落选择 = 开；偏好没到位时保持默认，不闪列表
- `resolveFirstScreenRoute({cardsFirstScreenEnabled})` → 开 = `{name:"Web", params:{path:"/phone-cards"}}`，关 = `{name:"Home"}`
- `shouldApplyFirstScreenRoute({route, preferencesLoaded, routeNames, index})` → 只认「没被人碰过的启动栈」：偏好已到位 + 目标是卡片 + `index === 0` + 栈恰好是 `["Home"]`
- `isPhoneCardsLandingPath(path)` → 认流本身（带 query 也算），不认单张卡片 `/phone-cards/<id>`

**新增 `FirstScreenGate.tsx`**，挂在 `Stack.tsx` 的 `RootStackLayout` 里（`ThreadOutboxDrainWorker` 旁），`navigation.dispatch(StackActions.replace(name, params))`。这是仓库里「把某个屏幕变成根」的现成写法（`ConnectOnboardingRouteScreen`、`ConnectionsNewRouteScreen` 都这么回 Home）。它自己不会重复触发：接管完栈变成 `["Web"]`，判定条件就再也不成立了。

时序上不会闪：`AdaptiveWorkspaceLayout` 在偏好 `isSuccess` 之前渲染 `null`，而偏好首次落库前是 `Pending` 不是 `Success`，所以门控和首帧在同一批提交里完成。Web 的 `presentation: "fullScreenModal"` 对根路由无效——`RNSScreenStack.mm` 的 `updateContainer` 里，列表第一个 screen 永远走 push 分支。

**`PhoneWebRouteScreen.tsx`**：`isCardsLanding` 时用 `navigation.setOptions` 推 `{title:"卡片", headerRight:「线程」按钮}`，否则还原 `{title:"", headerRight:undefined}`（流和单卡共用一个 screen 实例，必须还原）。「线程」= `navigate("Home", undefined, {pop:true})`，`pop` 保证连点不会堆两个列表。按钮用普通 `headerRight` 而不是 `NativeHeaderToolbar`，后者依赖 iOS 26 的 `unstable_headerRightItems`，Android 用户会进不去线程列表。

**`HomeRouteScreen.tsx`**：卡片首屏开着时，紧凑分支的 header 追加 `headerBackVisible: true` + `headerBackButtonDisplayMode: "default"` + `headerBackTitle: "卡片"`。Home 当根路由时 UIKit 没有可退的 controller，不会凭空长出返回键，所以老路径外观不变。

**偏好**：`Preferences.cardsFirstScreenEnabled?: boolean`，同时补进 `sanitizePreferences` 的内联白名单和拷贝分支——这个 sanitizer 是白名单，漏一处重启就丢。设置页 General 段加 `SettingsSwitchRow`「首屏显示卡片流」（`useCardsFirstScreen` 读，不读裸偏好）。顺带给 `AppSymbol` 补了 `square.stack.3d.up → IconStack2` 的 Android 映射。

**没碰**：`automationLink.ts`、`automationUrl.ts`、通知/深链路径、`ios/`。

## 开关

设置 → General → 「首屏显示卡片流」，默认开。关 → 下次冷启动首屏还是线程列表（现状）。这是设备本地开关，跟 `threadListV2Enabled` 同类，不做跨端同步。

## 怎么验（本机实测输出）

```bash
cd apps/mobile
pnpm exec tsc --noEmit                                  # 无输出 = 0 错误
../../node_modules/.bin/vp test run src/features/home/firstScreen.test.ts
```

车道里 `pnpm exec vitest` 不存在（`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found`），跑单测得用 `vp test run`。`pnpm install` 只在本车道目录内跑过（车道无 `ios/`，不存在覆盖 expo-sqlite 源码的风险）。

红（`firstScreen.ts` 还不存在）：

```
 ❯ src/features/home/firstScreen.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/home/firstScreen.test.ts [ src/features/home/firstScreen.test.ts ]
Error: Cannot find module './firstScreen' imported from /Users/yee/Documents/agent/tooling/t3code/task/20260903-044427-K3b-Kuca-iOS-App-首屏改成-最新-1/apps/mobile/src/features/home/firstScreen.test.ts
 ❯ src/features/home/firstScreen.test.ts:3:1
      1| import { describe, expect, it } from "vite-plus/test";
      2|
      3| import {
       | ^
      4|   PHONE_CARDS_PATH,
      5|   isPhoneCardsLandingPath,

 Test Files  1 failed (1)
      Tests  no tests
```

绿（写完纯函数模块之后，同一个命令）：

```
 RUN  v4.1.9 /Users/yee/Documents/agent/tooling/t3code/task/20260903-044427-K3b-Kuca-iOS-App-首屏改成-最新-1/apps/mobile


 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  05:01:42
   Duration  208ms (transform 29ms, setup 0ms, import 40ms, tests 2ms, environment 0ms)
```

相邻套件（`src/state/preferences.test.ts`、`src/features/threads/threadListV2.test.ts`、本测试）：

```
 Test Files  3 passed (3)
      Tests  53 passed (53)
```

`pnpm exec tsc --noEmit` 最终无输出。

真机复验（主线做）：`Documents/automation/ARMED` + `t3code://automation/report`，报告里的 `route` 应为 `{"name":"Web","params":{"path":"/phone-cards"}}`；再 `t3code://open-thread/...` 冷启动，应仍旧直落线程（门控见到非干净栈就撒手）。

## 已知边界

1. **`src/features/web/PhoneWebRouteScreen.test.tsx` 在本基线上就是红的**，与本改动无关：它 import 被测模块的纯函数，而模块图里的 `expo-constants` 在 node 环境炸 `ReferenceError: __DEV__ is not defined`。我用 `git show HEAD:` 的原文件单独跑过一遍，失败信息与统计完全一致（`Test Files 1 failed (1)` / `Tests no tests`）。要修得动测试环境（注入 `__DEV__` 或 mock expo），超出本车道范围，留在这里给主线定。
2. iPad 分栏（`layout.usesSplitView`）没适配卡片首屏：门控在 `AdaptiveWorkspaceLayout` 之上，拿不到布局上下文，强行动态 `initialRouteName` 又回到上面那堵墙。iPhone 需求内。
3. 通知进线程时，如果 App 已在前台跑着卡片首屏，返回键会落到卡片而不是列表——换首屏的必然结果，冷启动路径不受影响。
