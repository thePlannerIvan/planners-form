# DSH Review Dock

可选命令通道：`review.command(payload)` 经认证父窗口转发到 `/api/review.command`，再调用已安装的 Planners Review Core（`planners-review-core`）的共享 runner。插件从 Skill 安装目录发现 Core，并使用同一份 Core 的桥与 runner；surface 声明 `command_backend: "svg-workbench/1"` 与 `command` 能力。命令、回执和模型 CLI 的边界见该 Core 安装目录下的 `references/command-transport.md`。插件不增加整套侧栏反馈控件。

仅在隔离测试或需要显式选择 Core 安装时，将 `reviewCoreDir` 或 `DSH_REVIEW_CORE_DIR` 设为目标 Core 的绝对目录；测试可指向候选副本，普通安装无需候选目录。显式指定优先于自动发现；修改配置后重新加载插件。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--only-2563eb)](LICENSE)

把**审阅**做成 DSH 右侧栏里的一页：不是弹窗、不是另开的网页，而是和文件树、终端并列的原生标签页。

> 作者：阿祖不看 TVC（小红书同名）· [demyth.info](https://demyth.info) · [Lawyif@163.com](mailto:Lawyif@163.com)

## 它是什么

一个**通用宿主**。它不懂你在审什么 —— 不懂页、不懂镜、不懂 Beat、不懂"通过"是什么意思。

产出方（一个 Skill）交两样东西：

1. 一份 **`review-surface.json`** —— 说清页面在哪、资产在哪棵树、反馈写进哪个文件、唤醒模型时说哪句话；
2. 一个**自己的审阅页**（HTML + 资产）—— 想多复杂就多复杂。

插件把它挂进侧栏、把页面显示出来、把页面要的字节递过去、把结果落盘并唤醒模型。**审什么、能下什么决定、怎么绑版本，全是页面自己的事。**

```text
Agent 产出 → review_open 打开审阅页 → 人在页面上审、写意见、下决定
          → 桥把决定交给宿主 → 落进 surface 声明的反馈文件 → 唤醒 Agent
          → Agent 只改被指出的那一处 → 页面自己换那张图
```

关键在于**不阻塞**：提交是一个普通动作，写完盘再给当前会话递一句话，Agent 因此拿到一个普通 turn。对话全程可用。

## 接缝

### `review-surface.json`（产出方 → 宿主）

```jsonc
{
  "contract_version": "review-surface/2.0.0",
  "id": "planners-bypage/bypage",          // <skill>/<面>
  "title": "逐页审阅",
  "description": "逐页看内容与来源，可逐页提交",
  "project_root": "../../..",              // 相对本文件；包含性校验的上界
  "dir": ".",                              // 相对本文件；宿主只 serve 这棵树
  "entry": "index.html",                   // dir 里的入口
  "feedback": "review-feedback.json",      // 相对本文件；省略 = 这个面不落反馈文件
  "watch": ["shots/manifest.json"],         // 可选：这些文件的元数据一变，就戳一下页面
  "wake": { "mode": "queue", "text": "第 {unit} 页已定；其余页仍在审，只改这一页。" },
  "capabilities": []                       // 声明需要宿主提供哪些能力；未知值宿主忽略
}
```

**契约的权威是 `planners-review-core`** 里的 `contracts/review-surface.schema.json` 与 `scripts/validate-surface.mjs`（唯一校验器）。本插件**只读这份文件的四个字段**（`dir` / `entry` / `feedback` / `wake`）与两个展示字段（`id` / `title`）—— 它不解释任何审阅语义。

入口 HTML 里必须留一个 **`{{REVIEW_BRIDGE}}` 注入点**，并**不要**在页面里放一份桥的副本。宿主在 serve 时把桥注入进去，页面用同一份 `review-bridge.js` 在两种宿主下说同样的话：

```js
const review = await ReviewBridge.connect()
const url = await review.asset('shots/page-03.png', { v: 'v2' })  // 图片 → 帧里造 blob，可放进 <img src>
const text = await review.readText('snapshot.json')               // 文本 → 帧里解码（read 拿到原始字节）
await review.write(document)   // document 是什么形状由你定；宿主原样落盘，不加任何包装
await review.wake({ unit: 'page-03' })
review.on('changed', ({ units }) => { /* 宿主推来的「这些单位变了」 */ })
```

**规范写法是裸标记、独占一行**（契约与校验器就认这一种）。宿主同时容忍两种旧写法 —— `<script src="{{REVIEW_BRIDGE}}"></script>` 与 `<script>{{REVIEW_BRIDGE}}</script>` —— 因为它们已经出现在生产里。**三种写法注入后是同一个页面**：标记（或包着它的那个元素）被整体换成一段完整的 `<script>…桥…</script>`。裸标记尤其不能只吐源码：那不是 script，桥根本不会执行，页面会**安静地死掉**（实测：旧逻辑下页面里只有 1 个 `<script>`、桥在 `<script>` 之外；现在 2 个、桥在里面，`ReviewBridge.VERSION` 在帧里拿得到）。

### `write` 落盘的形状

**`feedback` 文件里就是页面交上来的那个 JSON 本身**（美化缩进 + 一个换行），没有 `receivedAt`、没有 `payload` 外壳、没有任何宿主加的字段 —— 文件形状由产出方定义，宿主只负责写。无插件宿主（`planners-review-core/scripts/serve-review.mjs`）写的是同一份字节，两个宿主对同一个 payload 必须产出**逐字节相同**的文件。

### `wake` 说的是哪句话

页面可以在 `wake({ unit, text })` 里**用自己的整句话覆盖** surface 的 `wake.text`（例如"整套提交"要说的不是"只重出这一页"）；只有页面没给 `text` 时才回落到 surface 的模板，并把 `{unit}` 替换掉。这与无插件宿主一致。

### 宿主用哪一份 `review-bridge.js`

已安装的 Skill 目录（`~/.dsh/skills`、`~/.claude/skills`、……）里放的是**发布副本**，而 `02-skills-library` 里的检出才是**真相源** —— 两者在有人改桥的那一刻就会不一致。宿主因此在所有能找到的副本里**挑 mtime 最新的那一份**（并在有多份时记一条 warn），不会让一个陈旧的发布副本悄悄赢过刚改过的源。

光挑最新还不够：**内联之前还要核对它是否具备本宿主会用到的每一个方法**（`connect` / `VERSION` / `asset` / `read` / `readText` / `write` / `wake` / `upload` / `on`）。缺任何一个就**明确拒绝**，并在错误里说清"解析到的是哪一份、缺什么" —— 绝不内联一份缺方法的桥。理由和线协议那次一样：**跨副本漂移最坏的失败方式是静默**（页面看着正常，永远不动）。同一个检查也在 `review_open` 里先跑一遍，这样 Agent 当场就知道，而不是等人对着一个死页面。

### 通知模型：幂等、去重与核验

**这是踩过坑的一节，写给下一个做"通知模型"的插件。**

**① 宿主按 `requestId` 去重，而去重命中时不投递、却报成功。** 实测（`dsh-api-session-controller/lib/index.js:854`）：

```js
if (hasPromptRequest(agent, request.requestId)) return { accepted: true }   // 什么都没入队
```

`hasPromptRequest` 会同时查**待处理队列**和**整条会话日志**里的 `user/message`。所以**同一个 requestId 第二次调用 = 静默丢弃**，返回值与真正投递时**一模一样**。

**② 所以唤醒的身份必须是"这一次提交"，不能是那句话。** 本插件曾经用 `sha256(sessionId, surface, unit, text)` —— 而页面的"整套提交"永远送同一句 `text`，于是**同一个会话里第二次以后的整套提交全部被去重掉**（真人审阅时实测：17:33 那条收到，17:41 那条没了，页面还显示成功）。现在身份折进**本次 feedback payload**：页面每次提交都会带新的 `provenance.submitted_at` 和新的 `items[].id`，所以每次提交必然不同。`write` 因此必须带上 `sessionId`（宿主按 session+surface 记住"这次提交是哪一次"）。没有前置 `write` 的唤醒（手写 curl 之类）拿一个每次调用都不同的身份：**没有提交可幂等，就绝不静默去重。**

> **哈希前必须先剥掉易变字段（0.2.2）。** 上面那句"每次提交必然不同"是靠 `submitted_at` 和 `items[].id` 撑起来的 —— 可这两个字段**在页面重新 `collect()` 时也会变**。于是"同一次提交重发"根本拿不到同一个身份：重试、断线重连、页面重新投递，每一个都会被当成一次新提交，**真的再唤醒模型一次**（本来去重就是为这件事存在的）。现在 `submissionIdentity()` 先把这三样剥掉再哈希 —— `provenance.submitted_at`、`provenance.wake`、每条 `items[].id`。它们是投递记录，不是提交内容；**结论、文字、框选、图片、每页版本号全部留在哈希里**，所以真改过的提交照样是一个新身份。

**③ 核验必须比 seq，不能扫日志找同 id。** 命中去重的那一次，日志里**确实存在**同一个 requestId —— 只不过是**上一次**投递的。老实现从日志末尾往前扫整条日志，于是**在出事的那一次报了成功**（假绿，比故障本身更坏）。现在的规则是：`prompt` **之前**记下会话最新事件的 `seq`，之后只承认 **`seq > before`** 的证据。四种状态如实返回：

| 状态 | 含义 | HTTP |
|---|---|---|
| `in-turn` | 有回合已经把它变成 `user/message` | 200 |
| `queued` | 在持久队列里（`agent/inbox/spliced`），还没回合取走 | 200 |
| `duplicate` | 这一次提交**之前**已经送达过，本次调用没有新增通知（带旧 `seq` 与 `before`） | 409 |
| `undelivered` | 宿主说 accepted，日志里却没有任何新东西 —— 就是被去重吞了 | 502 |

调用方要**至少一次**语义时，`duplicate` 应当读作"已经送达"（它给了旧的 `seq`）；要"这一次调用是否投递"时它就是红。

**宿主层报 409、面板层报"准确的成功"** —— 这两件事不矛盾，是同一个规则的两面：**不许把"没法核对"说成成功，也不许把成功说成失败。** `duplicate` 的真实语义是"这次提交已经落盘、而且之前已经送达过"，所以面板里显示的是

> 已写入；本次没有新增通知（同一次提交之前已送达）

而不是「保存失败」。"保存失败"会是**假阴性** —— 和之前那个假阳性一样是骗人，只是方向相反。

**④ 重发用同一个身份。** 确认不到就按**同一** id 重发 —— 去重这时才在帮忙而不是在吞消息。

**⑤ 不要指望 `updateQueue` 兜底。** 它只能编辑/撤回/steer **还在队列里**的条目（`edit` 仅文本、`remove` 撤回、`steer` 仅当目标在 `next-turn` 且 agent 正在跑），对**已经被去重掉的**消息和**躺在队里没人取**的消息都无能为力。

**⑥ 一条量到的限度（不要读成"队列可能永远没人取"）**：**在回合失败的路径上**观察到队列不会被自动排空 —— 一条已入队的消息在队列里躺了 64 秒，直到下一次 prompt 才被顺路取走（`wakeDriver` 在 `dsh-agent-loop` 之外没有调用者）。而 `turn` 结束时 `if (!this.inbox.hasPending) return false`（`dsh-agent-loop/lib/index.js:1014`）在**健康回合**结束后会再开一个回合，所以健康路径的行为**未测**。

### `capabilities` 的含义：宿主支持 ∩ surface 声明

`init` 里的 `capabilities` 是**"这个面现在真正能用的"**，不是 surface 声明了什么，也不是宿主支持什么 —— 是两者的交集。**广告一个做不到的能力，等于让页面摆出一个必然失败的控件。**

本宿主目前有 `asset-upload` 与 `draft` 两项，而且它已经**真的能用**（`POST /api/review.upload` 落盘）：surface 声明 `["asset-upload"]` → 页面拿到 `["asset-upload"]`，上传控件亮起来；surface 不声明 → 页面拿到 `[]`，而且**即便绕过页面直接调那条路由也会被 403 拒掉**。广告一个做不到的能力等于让页面摆出一个必然失败的控件，所以这一列只放做完的事。

**上传上限：16 MiB。** 无插件宿主没有上限（它只有连接层 300 MiB 兜底），那是**缺口而不是范本**：这些字节还要作为 postMessage 载荷穿过面板，父页面与帧里各驻留一份，所以一次调用该有个界。16 MiB 是一张 1920×1080 PNG 的好几倍。超限回 **413** 并在正文里写清"多少字节 > 上限"。

**落盘位置**：`rel` 相对 **surface 的 `dir`**（与 `asset`/`read` 同一个基准），写入前做与 `asset` 同源的 realpath 包含性校验，并额外拒绝两条写操作特有的路径：**现有目标是符号链接**、以及**最近的已存在祖先经 realpath 后落在 `dir` 之外**（否则 `dir` 里一个指向外部的软链目录就能把新文件写到外面）。越界回 403。

这个基准不是随便定的：反馈文件的消费者就是这么解析的 —— `planners-bypage/scripts/import-review-assets.mjs` 用 `resolve(dirname(feedbackPath), attachment.path)` 取上传文件，而反馈文件就在 `dir` 里。**页面写进去的路径、宿主落盘的位置、收件层读出来的位置，是同一个基准。**

（无插件宿主 `serve-review.mjs` 回的是它**自己支持**的列表而不是交集 —— 同一个字段两种含义，这正是要写下来的原因。）

### 「变了」是怎么送到的

`watch`（可选）是一组**相对 surface 文件**的路径 —— 是**相对那个 `review-surface.json` 自己**，不是相对 `dir`。这条基准很要紧：surface 常常住在子目录里（`<项目>/review/review-surface.json`）而 `dir` 是项目根，于是 `"../timeline/timeline.json"` 只有按 surface 文件解析才落在宿主真正要看的那份文件上；按 `dir` 解析会指到一个**不存在的路径**，token 恒定，**戳永远是哑的**，而面照样"打开成功"。（宿主实测过：修之前 `watch` 指向 `<项目>/../timeline/timeline.json`，创建/删除那个文件才会步进；修之后改真正那份才步进。）

宿主每 2 秒在**已有的那条 `/api/review.current`** 上顺手 `stat` 它们一次，**只看 `mtime` + `size`，从不读内容** —— 所以它仍然不知道"什么变了"，只知道"有东西动了"。元数据一变就步进一次计数器；页面收到一次 `{ type: 'review/changed' }`（**不带 payload**），自己去读、自己去 diff、自己决定换哪张图。

**越出 `dir` 的 watch 项会被说出来，不会被静默丢掉。** `review_open` 的返回里有 `warnings`：例如 `watch 项落在 surface.dir 之外，未监视（校验器会报 watch_outside_dir）：../../outside.json → …`。面照开（手改过的 surface 不该打不开），但**绝不让你对着一个哑面干活** —— 校验器对同一种情况报 `watch_outside_dir`，宿主不该比校验器更安静。

刻意**不用 SSE**：`dsh-client-hmr` 那条 SSE 是**裸路由、不走认证**，与"本插件不注册任何无鉴权路由"直接冲突；而 `/current` 已经在鉴权围栏内、已经被每 2 秒调一次，是现成的通道。

一次步进只戳一下，值不变就不戳 —— 否则人正在写的意见会被无意义地打断。帧**从不重载**：戳是一条消息，不是一次导航。

### 为什么资产与桥都走"宿主递字节"，而不是让页面自己去取

**因为页面在 DSH 里是一个 `sandbox="allow-scripts allow-same-origin"` 的 iframe（0.2.5 起）。**

历史实测（opaque 时代）表明：不透明帧自己发起的**任何**子资源请求，到达宿主时都带着

```text
Sec-Fetch-Site: cross-site        Cookie: absent
```

`/api` 上的信任栅栏对 cross-site 一律 **403（在认证之前）**。同源之后页面本可直接取，但桥仍保留“宿主递字节”的契约，避免页面依赖 DSH 的 cookie 与路由细节：

- `<img src="/api/review.asset?…">` → 403，且**不带 cookie**；
- `<script src="/api/review.bridge">` → 同样的 403。

**结论：`/api` 下的任何东西都不是给那个帧直接用的。** 字节由**父页面**（同源、带 cookie）取回，用 postMessage 交给帧，帧自己造 blob URL：

```text
父页面 fetch('/api/review.asset')  →  arrayBuffer()  →  postMessage（结构化克隆，不走 base64）
                                                        ↓
                                          子帧 new Blob([bytes]) → URL.createObjectURL
```

桥同理 —— 由宿主把**源码内联**进注入点（`/api/review.bridge` 保留为桥字节的具名出处，但它不在帧的关键路径上）。

## 插件做什么（就这四件）

| | 实现 |
|---|---|
| 选哪个面 | 工具 `review_open`；面板轮询 `/api/review.current` 认领标签页 |
| 显示 | `/api/review.page` —— serve surface 的入口 HTML，并把桥注入进去 |
| 递字节 | `/api/review.asset`（单文件，realpath 校验必须落在 `dir` 内）；`/api/review.bridge` |
| 落盘 + 唤醒 | `/api/review.write`（**把 payload 原样写进 feedback —— 这是决定**）；`/api/review.draft`（同一个纪律，写进 surface 声明的 `draft` 文件 —— **这是没提交的草稿**：不唤醒、Skill 不许当它是收件）；`/api/review.wake`（页面给 `text` 就用它整句，否则套 surface 的 `wake.text` 并替换 `{unit}`） |

## HTTP 面

**全部七条都在 Connection 的 `/api` 栅栏下**，任何一条没有浏览器会话 cookie 都返回 401，且请求的 `Origin` / `Sec-Fetch-Site` 必须先过 Host/Origin 校验：

```text
GET  /api/review.current                      Agent 最后要求显示的面（+ revision）
GET  /api/review.surface?surface=<abs json>   面的 meta：id / title / capabilities / wakeMode
GET  /api/review.page?surface=<abs json>      入口 HTML（桥已注入；缺注入点就拒绝）
GET  /api/review.bridge                       桥的具名出处（页面并不直接取它）
GET  /api/review.asset?surface=<abs json>&rel=  dir 树内的一个文件
POST /api/review.upload?surface=<abs>&rel=   原始字节写进 dir 内的 rel（上限 16 MiB）
POST /api/review.write                        {"surface","payload"} → 把 payload 原样写进 feedback 文件（决定）
POST /api/review.draft                        {"surface","payload"} → 把 payload 原样写进 draft 文件（未提交的草稿）
POST /api/review.wake                         {"surface","unit","sessionId"} → 递一句 prompt
```

**本插件不注册任何无鉴权路由。** 这是刻意的：`?surface=` 接受任意绝对路径，只有落在 surface 声明的 `dir` 内的文件才会被送出，而这层保护必须站在认证之后才成立。

### 唤醒的核验（为什么它返回的不只是 "ok"）

`wake` 按 `wake.text` 替换 `{unit}` 后递进会话，并**回读**确认那句话真的进了 Agent 的收件箱：

```jsonc
{ "ok": true, "requestId": "review-…", "sessionId": "session-…", "mode": "queue",
  "text": "第 page-03 页已定；其余页仍在审，只改这一页。",
  "verified": { "where": "session log: agent/inbox/spliced", "seq": 3,
                "target": "next-turn", "equalsWakeText": true } }
```

`verified.where` 只会在三处之一点头：`agents.get(sessionId).inbox`（已入队）、`session log: agent/inbox/spliced`（入队的持久记录）、`session log: user/message`（回合已把它落进日志）。**只查日志会把"真的发生了"的唤醒报成没发生** —— 一个 followup 先进收件箱，只有真的起了 turn 才写 `user/message`。核验不到时返回 `verified: { found: false, … }` 而不是假装成功；没有 `sessionId` 时直接 `ok: false`。

## 安装

DSH 自带插件管理器，用它的命令装，不要手改 profile：

```bash
# 从本地克隆装（把路径换成你 clone 的位置）
dsh plugin --profile web add /path/to/dsh-review-dock

# 仓库发布之后，也可以直接按 git 形式装（插件管理器支持 git shorthand）
dsh plugin --profile web add github:thePlannerIvan/dsh-review-dock

# 重启 dsh web 生效
```

这条命令会做三件事：把插件加进 `~/.dsh/profiles/web/package.json` 的 `dependencies`、把 `"dsh-review-dock"` 追加进同一份文件里的 `dsh.profile.bundles`、然后 `pnpm` 把它装进 profile 的 `node_modules`。**不需要手动编辑任何文件。**

**装在 DSH 桌面应用里**（`desktop` profile，由应用托管）：CLI 会被拒（`profile "desktop" is managed exclusively by the Electron application`），改用应用内的**插件管理器**，安装源填插件的绝对路径。它是**热生效**的 —— 不用重启应用：`review_open` 立刻出现在工具表，`sidebar.right.pane.tab` 的占用者里立刻出现 `dsh-review-dock`。装完确认两处，都不要手改：`~/.dsh/profiles/desktop/package.json` 的 `dependencies` 有 `dsh-review-dock`，且 `dsh.profile.bundles` 里有同名条目。

**确认装上了**（三种，任选）：

```bash
dsh web --dump-config | grep -A 2 review-dock      # 组合出来的 profile 树里出现它
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:PORT/api/review.nonexistent   # 404
# 带 cookie 请求 /api/review.current 应当是 200 并回 {"ok":true,...}
```
最后一条是关键：`/api/*` 对**未登录**请求一律回 401（**连从未注册过的路径也是**），所以**没有 cookie 时看不出插件在不在**；带上会话 cookie 之后，注册过的路径回 200/400，没注册的回 **404**。UI 上的确认更直接：右侧栏的标签条会出现「审阅」这个 kind。

> **一道对所有请求都同样回答的围栏，证明的是围栏，不是门后的东西。**
> 验收必须有一个**会失败的对照组**：这里是"带上 cookie 之后，注册过的路径 ≠ 从未注册的路径（404）"。
> 只看到一串 401 就宣布"路由都在"，是把围栏当成了门。

**卸载**：

```bash
dsh plugin --profile web remove dsh-review-dock
# 重启 dsh web
```

**版本要求**：`peerDependencies` 声明 `"@deepseek-ai/dsh": "^0.1.7-rc.1 || ^0.2.0-rc.1"`（这是 DSH 自己的约定，插件管理器按 semver 逐项校验 `@deepseek-ai/dsh*`，**prerelease 参与区间比较**）。0.1 线与 0.2 线都在闸门内；换到未声明的运行时，管理器会**拒绝加载**并打印一条处置命令（`dsh plugin allow-version … --accept-risk`），而不是带着风险静默跑起来。

> **区间写窄了会静默消失。** 只看 `^0.1.7-rc.1` 时，`0.2.0-rc.2` 不满足（`<0.2.0` 的上界不含 0.2.0 的 prerelease），宿主的 `loadProfile` 会把这条 bundle **跳过**：桌面端 profile 由应用托管，跳过时不打印任何东西 —— 侧栏标签消失、`review_open` 从工具表里消失，而 profile 里的声明看起来完好无损。

**开发模式**（改 `lib/client.js` 不想重启时）才用软链：

```bash
ln -sfn /path/to/dsh-review-dock ~/.dsh/profiles/web/node_modules/dsh-review-dock
```
`lib/client.js` 是无需构建的普通 JS，client-modules 的 HMR 会重新哈希并推送新 bundle；但 **host 半边 `lib/index.js` 的改动要重启 `dsh web`**（`dsh-hmr` 默认 `root: []` 不监听源码）。

## 用法

1. 打开右侧栏 → 引导页上点「审阅」胶囊。
2. Agent 也能把你带过来：`review_open` 打开右侧栏并把面板指向那个面（面板通过带当前 `sessionId` 的 `/api/review.current` 认领标签页）。审阅面按会话隔离；切换对话不会继承另一个对话的面，刷新后由当前会话重新认领。
3. 之后的一切都在**页面上**：怎么列、怎么看、怎么下决定，是产出方设计的。

## 已验证

实测环境：**DSH 0.1.7-rc.2**（宿主与前端 dist 均取自带 integrity 校验的 `app.asar`）+ **Chromium 147（headless，Playwright）**，在一个隔离的 `DSH_HOME` 实例上驱动**真实侧栏标签页**（不是复刻页面）：

- surface 的入口 HTML 经 `/api/review.page` 送达，注入点换成内联桥，`ReviewBridge.connect()` 拿到 `init`（`transport: "postMessage"`，`surface.id/title`）；
- **一张真实图片在帧里显示出来**（`naturalWidth > 0`，`src` 是帧自己造的 `blob:`）；
- 一次 `write` 落进 surface 的反馈文件，且**文件解析出来与页面交上去的那份文档深度相等**（没有宿主信封）；
- 一次 `wake` 产生真实 prompt（`agent/inbox/spliced` → `turn/start`），且**页面给的整句话覆盖了 surface 模板**；
- 相同 nonce、来自错误窗口的伪造消息被 `event.source === frame.contentWindow` 判掉；帧内合法调用照常落地；
- `keepMounted: true` 让帧在切走标签页后依然存活（切回时桥的 nonce 不变）；
- **通知不丢**：同一个会话里**两次不同的整套提交**（同一句话、不同 payload）→ 日志里出现**两条不同 requestId** 的 `user/message`（真页面实测 seq 8 与 22）；**同一次提交重发** → **409 `duplicate`**，且证据是**比本次调用更旧**的 seq（`verified.seq: 22 < before: 25`）—— 假绿变成如实报红。
- **`asset-upload` 端到端，跑在真实的 Skill 页面上**（bypage 的逐页审阅面，`dir` 就是那个真实项目的审阅目录）：页面上传控件亮起来（20 个 dropzone）、走页面自己的 `uploadFiles` 路径上传一张真图 → 落在 `uploads/page-03/probe-*.png`，**74 字节、sha256 与源文件一致、逐字节相同、在审阅目录之内**；而**收件层的解析基准落点与它完全相同**（`resolve(dirname(feedbackPath), path)`）。同一个页面换成**不声明**该能力的 surface → 页面拿到 `capabilities: []`，宿主那条路由回 **403 + "这个 surface 没有声明 asset-upload 能力，拒绝上传"**，磁盘上什么都没写。
- **`read` / `readText`**：帧里 `await review.readText('review-surface.json')` 拿到的**字符数与磁盘上那份完全一致**、JSON 解析出正确的 `contract_version`；`read` 拿到的是真正的 `ArrayBuffer`（491 字节）而不是 base64。
- **变化戳，经真实浏览器的桥验过**：不碰被 watch 的文件时 3 个轮询周期内 `review.on('changed')` **零次**触发；改一次文件**恰好一次**；值不变不重复；再改一次第二次。全程帧的 nonce 不变（没有重载），且**控制台零输出** —— 既没有"旧拼法"的 warn，也没有"不认识的类型"的 warn，证明到达页面的是规范拼法。宿主侧的"元数据 → 计数器"另有一组单元测试（真实 `stat`、真实文件）。

**安装（在全新 `DSH_HOME` 里真跑过，不是"应该能装"）**：`dsh plugin --profile web add <路径>` → 依赖与 `dsh.profile.bundles` 被自动写好 → 组合树出现 `# == dsh-review-dock` → 带 cookie 的 `/api/review.current` 回 200（未注册路径回 404）→ 浏览器里标签条出现「审阅」并**成功打开一个面**（帧内 `ReviewBridge.VERSION = "2.0.0"`）→ `remove` 之后重启，同一条路由回 **404**。**声明了 `peerDependencies` 之后再从头装一遍同样通过**（`Done in 338ms`，pnpm 没有去 registry 抓 `@deepseek-ai/dsh`）。

**版本闸门**：直接调用 DSH 自己的 `evaluatePluginCompatibility` 验证 —— `^0.1.7-rc.1 || ^0.2.0-rc.1` 接受 `0.1.7-rc.1` / `0.1.7-rc.2` / `0.1.8` / `0.2.0-rc.1` / `0.2.0-rc.2` / `0.2.5`，拒绝 `0.3.0` 并给出处置命令。

**`0.2.0-rc.2` 上的回归**（隔离 `DSH_HOME` 实测）：组合树出现 `# == dsh-review-dock`；带 cookie 的 `/api/review.current` 回 **200**，`review.surface` / `review.page` / `review.asset` 回 400（已注册、缺参），POST 的 `review.wake` / `review.write` / `review.upload` 回 400，**未注册路径回 404**（对照组）；`review.bridge` 回 200 且字节来自 Skill 里的 `review-bridge.js`。依赖的宿主 API 逐个核对未变：`connection.fetch.register`、`tools.register`（`output.render` 仍是必填）、`sessionController.inspect` / `prompt`、`agents.get(id).inbox.nextTurn` / `nextStep`、`agent/inbox/spliced`、`user.message.source.rpcId`、`sidebarRightTabs.register({ keepMounted })`、`sidebar.right.pane.tab` 与 `.title`。

**`0.2.1-rc.1` 上的回归**（2026-10-17，隔离 `DSH_HOME` 实测）：组合树出现 `# == dsh-review-dock`；`review_open` 在工具表、`sidebar.right.pane.tab` 的占用者含 `dsh-review-dock`；`review.bridge` 返回的字节与 Core 桥 sha256 相等；`review.current` / `surface` / `page` / `asset` / `draft` / `write` / `wake` 的 200/400/403/404 与 0.2.0-rc.2 一致；Core 的 `node evals/run.mjs` 59/59，命令链路用真实 `workbench_store.py` 端到端跑通。DSH 0.2.1 起版本闸门优先看 `engines.dsh`（本包未声明，仍按 peer 区间判断），`^0.2.0-rc.1` 覆盖本版。

在**由应用托管的 `desktop` profile** 上安装（`dsh plugin --profile desktop` 会被拒，改用应用的插件管理器），host 与 client 两半都无需重启即生效：`review_open` 出现在工具表，`sidebar.right.pane.tab` 的占用者里出现 `dsh-review-dock`，声明落在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 两处。

`0.1.7-rc.1` 上同样存在本插件依赖的两个 API（`connection.fetch.register`、`sidebarRightTabs.register({ keepMounted })`），但未逐项回归。

**尚未验证（要等仓库发布之后才能验，属 B9 验收项，不是已知缺陷）**：`dsh plugin --profile web add github:<repo>` 这种 **git 形式**的安装；以及把 `npm pack` 出来的 **tgz** 装进去。两者都只从 CLI 源码确认了形式受支持，**没有真跑过** —— 所以本文件不说"支持"。

**Node ≥ 20**（见 `package.json` 的 `engines`）。

## 已知边界

- **变化信号走轮询，不走推送**：面板每 2 秒调一次 `/api/review.current`，它同时带回"Agent 换了面"（`revision`）与"被 watch 的元数据动了"（`changedSeq`）。没有 SSE —— 见上一节的理由。
- **宿主只送规范拼法 `review/changed`**：桥也认它。桥对旧拼法 `changed` 容忍但会 `console.warn`，对任何不认识的 `review/*` 类型也会出声 —— 这条线最坏的失败方式是**静默**（页面一动不动、零报错），所以两边都不许安静。
- **上传有上限（16 MiB）**：见上一节 —— 这是相对无插件宿主**有意收紧**的一处，理由是字节要经过面板中继；超限是明确的 413，不是静默截断。
- **`?surface=` 接受任意绝对路径**：保护来自"必须带浏览器会话 cookie" + "只送 `dir` 树内、realpath 校验"。
- **隔离边界已调整（0.2.5）**：页面使用 `sandbox="allow-scripts allow-same-origin"`，因此可以运行 HyperFrames 播放器这类需要内层同源 iframe 的工程态预览；代价是**审阅页被视为可信代码**，能访问 DSH 应用的 DOM / storage / API。只应在审阅页来源可信时使用。
- **多会话并行**：`/api/review.current` 按 `sessionId` 读取各自的 surface、revision 与变化戳；两个会话可以同时打开不同审阅面。侧栏不再用跨会话的浏览器缓存记忆 surface，切换会话时不会继承另一会话的面。
- **页面作者要自己写"变了怎么办"**：宿主只负责把 `changed` 送进去，不负责页面怎么响应，也不碰人的输入状态。

## 品牌与署名

作者署名与项目名不随许可证授权；fork 请改名或显著标明。见 [TRADEMARK.md](TRADEMARK.md)。

## 许可与商业

- 代码以 [AGPL-3.0-only](LICENSE) 发布；
- 请保留 [NOTICE](NOTICE) 中的项目来源与作者信息；
- 私有部署、接你自己的产线、闭源授权、定制与培训见 [COMMERCIAL.md](COMMERCIAL.md)。

## 变更

破坏性变更与本轮范围见 [CHANGELOG.md](CHANGELOG.md)。
