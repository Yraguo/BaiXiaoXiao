# 百小鸮小程序 · 工程说明

百小鸮原版（Android / Capacitor）搬到微信小程序，界面按原版照搬，支持深色模式跟随系统。

---

## 跑起来

```bash
npm install
npm run dev:mp-weixin      # 开发者工具导入 dist/dev/mp-weixin，AppID 选「测试号」
```

自检（都在 H5 产物上跑，不进小程序包）：

```bash
npm run build:h5 && node scripts/shot.mjs     # 六页截图
node scripts/e2e.mjs                          # 交互冒烟 31 项（含深色模式、小鸮问答）
node scripts/unit-jw.mjs                      # 教务协议层 33 项
node scripts/unit-xiao.mjs                    # 小鸮本地对话 60 项（109 条问法覆盖率）
```

## 结构：单页 + 自绘 tabBar

照原工程的做法：**一个页面装 5 个视图**，tabBar 自己画，不用原生 tabBar。

```
pages/main/index.vue      壳：页头 + 分段控件 + 5 个视图 + tabBar
views/
├── TimetableView.vue     课程表（表格：节次列 + 7 日列，课程块绝对定位）
├── NotesView.vue         记事本（月历 42 格 + 当天记事 + 全部）
├── SecondClassView.vue   第二课堂（自评 600 / 志愿时长 / 劳育时长）
├── XiaoView.vue          小鸮落地页 + 对话（对话逻辑在 services/xiao/engine.ts）
├── OnlineView.vue        校园通（10 个校园服务入口）
└── MeView.vue            我的（资料 / 自评摘要 / 偏好设置 / 备份）
pages/import/index.vue    从教务系统导入：选校 → 登录 → 预览入库
services/xiao/engine.ts   小鸮的离线对话引擎：规则 + 本机数据，35+ 意图
components/AppIcon.vue    图标（读 static/icons/*.png，由 scripts/make-icons.mjs 生成）
```

好处：切 tab 不重建页面、状态共享、tabBar 颜色能跟着主题走（原生 tabBar 只能靠 `theme.json`，深色要再配一份）。

## 深色模式

`src/services/theme.ts`

- 启动读一次 `uni.getSystemInfoSync().theme`，之后 `uni.onThemeChange` 跟随系统；
- 三种模式：跟随系统 / 浅色 / 深色，入口在 **我的 → 外观与主题**；
- 颜色全部走 CSS 变量：`page` 上是浅色，`.theme-dark` 上整套换掉（挂在 `.screen` 上）；
- 同时调 `uni.setBackgroundColor` 同步下拉回弹底色。

## 已经做完的功能

| 功能 | 说明 |
|---|---|
| 五页 UI | 课程表 / 记事本 / 第二课堂 / **小鸮** / 校园通 / 我的（照搬原版）|
| 图标 | 读原工程 `AppleIcon.vue` 的 SVG 路径光栅化，形状与原版一致，不用 emoji |
| 周次 | `‹ 第N周 10月19日–10月25日 ›` + 左右滑动切周 + 回本周 |
| 深色模式 | 跟随系统，也可手动锁定；弹层、表单、日历同步换色 |
| 从教务系统导入 | 正方 jwglxt 直连：取 csrftoken/RSA 公钥 → 加密提交 → 拉 kbList |
| 多学校入口 | 北化内置地址一键导入；其它学校可自己粘教务地址 |
| 验证码 | 自动识别 `yzm`，带同会话 Cookie 取图，可刷新 |
| 多课表 | 新建 / 切换 / 改名 / 改总周数 / 改第一周周一 / 删除 |
| 课程增删改 | 表格里点块看详情 → 编辑 / 删除；同名同时段成组删 |
| 记事本 | 月历、圆点、当天记事、全部列表、勾选完成 |
| 二课自评 | 五板块 600 分制（德 180 / 智 120 / 体美劳各 100） |
| **小鸮（离线）** | 35+ 个意图：课表/某门课在哪/作业/二课/时长/校园入口/情绪；全部本机算，**109 条问法实测 100% 命中**，答不上来直说不会 |

## 教务导入要配什么（真机前必看）

1. 小程序后台 → 服务器域名 → request 白名单加 `https://jwglxt.buct.edu.cn`。
   开发者工具能勾「不校验合法域名」，**真机不认**。
2. 必须 HTTPS、443 端口，不接受 IP 和非标端口。
3. 校外要连学校 VPN，教务系统一般只对校内网开放。
4. 验证码会话绑定：`beginLogin` 与 `submitLogin` 必须复用同一会话，别每次重开。

## 硬约束速查

| 不能做 | 原因 |
|---|---|
| `window` / `document` / `localStorage` | 小程序没有 DOM |
| `fetch` / `XMLHttpRequest` | 只有 `uni.request`，域名要备案+白名单 |
| `crypto.subtle` / `atob` / `TextEncoder` | 基础库不提供，已补纯 JS 版 |
| `color-mix()` / `backdrop-filter` | 安卓微信内核不支持或不稳定 |
| 读 `<web-view>` 内部 DOM | 容器隔离，无 Cookie 共享 |
| 排"学期级"本地闹钟 | 只有订阅消息，一次授权一条 |
| `div` / `span` / `img` | 必须用 `view` / `text` / `image` |

## 两个踩过的坑（别再犯）

- **类名不要叫 `.block`**：全局 `.btn.block` 是整行按钮工具类，scoped 样式会连它一起命中，
  按钮会变成绝对定位的色块。课程块叫 `.cblock`。
- **课程块的 meta 要单行**：7 列时列宽只有约 50px，`08:00-09:35` 会被折成两行，
  所以显示成 `8:00-9:35` 并 `nowrap`。

## 品牌

- 品牌蓝 `#2C6FE0`（沿用原版的 `--brand`），深色下提亮到 `#4C8DF6`
- 名字「百小鸮」，存储前缀仍是 `unimate:` —— **不要改**，改了等于丢老用户数据
