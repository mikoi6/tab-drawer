# TabDrawer · 标签抽屉

| 抽屉 · 按站点 | 抽屉 · 按标签组 | 本窗标签 · 逐个收纳 |
| --- | --- | --- |
| ![按站点聚类](docs/screenshot.png) | ![按标签组聚类](docs/screenshot-group.png) | ![本窗标签视图](docs/screenshot-tabs.png) |

一个 Manifest V3 浏览器扩展：把"暂时不看但绝对不能丢"的标签页收进抽屉，需要时再取回；
同时可选地自动**休眠**闲置的后台标签，把渲染进程的内存还回去。

> 想先看长什么样：直接双击 `preview.html`（用假数据的静态预览，不需要装扩展）。

---

## 一、它解决的两个不同问题

| 痛点 | 表现 | 对应能力 |
| --- | --- | --- |
| 视觉噪音 | 标签栏挤成一条缝，找不到正在用的那个 | **收纳**：一键把整窗标签变成一份列表，标签真的关掉 |
| 内存占用 | 30 个后台标签 ≈ 1~2 GB，风扇狂转 | **休眠**：标签留在栏上，渲染进程被回收，点一下重新加载 |

这两件事不要混着做。收纳是"我不想现在处理它"，休眠是"我马上还要用但你先别占着内存"。

## 二、安装（30 秒）

```bash
git clone git@github.com:mikoi6/tab-drawer.git
```

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）。
2. 右上角打开「开发者模式」。
3. 点「加载已解压的扩展程序」，选择克隆下来的 `tab-drawer/` 目录。
4. 工具栏上会多一个紫色抽屉图标，点它打开面板。建议在拼图菜单里把它**固定**出来。

快捷键（可在 `chrome://extensions/shortcuts` 里改）：

- `Alt+Shift+A` 把**当前标签**收进抽屉（连按可逐个收）
- `Alt+Shift+S` 把当前窗口其他标签收进抽屉
- `Alt+Shift+D` 立即休眠所有后台标签

## 三、三种收纳粒度

同一个动作提供了三条入口，按"手上正好在做什么"选：

| 场景 | 入口 |
| --- | --- |
| 就想关掉眼前这一页 | `Alt+Shift+A`，或页面右键 → **把这个页面收进标签抽屉** |
| 想一个个挑着关 | 面板切到「本窗标签」，每行右侧的**收纳**按钮 |
| 同一个网站开了 8 个 | 「本窗标签」里站点组头的**收这 8 个** |
| 已经框选了好几个标签 | 在标签栏上右键 → **收进标签抽屉**，选中的会一起进去 |
| 一次清空整个标签栏 | 面板顶部**收进抽屉（N）**，或 `Alt+Shift+S` |

> **关于标签栏右键**：`contexts:['tab']` 这个上下文值在文档里存在很久了，但 Chrome
> 真正实现它是 **150 版（2026-06-10 的稳定版）** 才完成的，之前注册会失败。代码里保留
> 探测式注册，所以 `minimum_chrome_version` 116 以上的版本都不会报错，150 以下只是少了这一个入口。
>
> Chrome 150 起还顺手支持了**多选**：按住 Ctrl 框选若干标签再右键，菜单项会一次性收到全部选中标签。
> 实现上不依赖这个新行为（`OnClickData` 里没有对应字段），而是用 `tabs.query({highlighted:true})`
> 取选中集合——但**必须校验被点的标签本身在集合里**，否则右键一个未选中的标签时，
> `highlighted` 返回的是当前活动标签，会把错的页面收走。

`Alt+Shift+A` 的妙处在于：关掉当前标签后浏览器会自动激活相邻标签，所以**连按就是逐个收**，
不需要额外做"拾取模式"。

## 四、三种聚类方式与标签组

抽屉列表有**时间 / 站点 / 标签组**三档切换，选择会被记住。本窗标签视图则永远按站点分组，
并把当前页所在站点排在最前。

**按站点聚类**：站点键不是简单取最后两段——`jw.gzhu.edu.cn` 会被切成 `edu.cn` 就错了。
`popup.js` 里用了一份二级后缀小抄（`com.cn` / `edu.cn` / `co.uk` …），命中时多取一段。
这**不是**完整的 Public Suffix List，但对个人项目够用；要零误判得引入完整 PSL 数据表。

**按标签组**：把你收纳前在标签栏上分好的组当作目录。组名和颜色一起作为键，
所以「同名不同色」会被算成两个组——合并反而会错。没进过组的条目统一归到垫底的**未分组**。

> 分组维度上已经写过的信息，条目里不再重复：按站点分组时不显示域名，按标签组分组时
> 不显示组名色点。少一层冗余，同样高度能多放两行。

**取回时重建组**：收纳时把组名和颜色一起存进抽屉，取回时按"同名同色"重新
`chrome.tabs.group()` + `tabGroups.update()`。存快照而不是 `groupId`，因为原组在你收纳完
就被浏览器回收了，`groupId` 没有跨会话意义。不想要可以在设置里关掉。

## 五、批量取回：先冻结，再按需加载

一次取回 30 个标签，等于 30 个渲染进程同时起来，网络和内存的峰值比不收纳还难看。这版的处理
方式是「并发 3 个建标签，每个一提交就立刻卸载」：标签栏上整齐出现一串灰色标签，点哪个才加载哪个。

### 一条绕不过去的硬约束

`chrome.tabs.discard()` **依赖已经提交（committed）的地址**——激活时它靠这个地址重新加载。
刚 `create` 就 discard，标签会退化成 `about:blank`，**地址就丢了**。

所以"零加载"在 Chrome 里做不到，能选的只是**在哪一步断掉**：

| 断在哪 | 省掉什么 | 代价 |
| --- | --- | --- |
| 提交前 | 全部 | 地址丢失，标签变成空白页 |
| 提交后（本版做法） | 渲染进程、JS 执行、子资源、页面内存 | 首次请求（DNS / 连接 / 响应头）仍会发出 |
| 加载完再断 | 只有内存 | 峰值已经完全付出去了 |

另外两个限制：`tabs.create` 的 `CreateProperties` **没有 `discarded` 字段**（那是 Firefox 才有的），
没法"一步创建一个休眠标签"；**活动标签不能 discard**，每个窗口至少留一枚真加载的。

### 实现是三个动作

1. **并发池**：固定 3 个 worker 从同一个游标抢活（`while (cursor < n)` 里 `targets[cursor++]`），
   比 `for` 里 `await` 一次性全建出来稳得多。
2. **等提交**：轮询 `tabs.get()`，`!pendingUrl && url && url !== 'about:blank'` 就算已提交。
   没用 `webNavigation.onCommitted`——那要多申请一个 `webNavigation` 权限，
   而这个扩展连 host 权限都没要，能不加就不加。
3. **卸载**：`freezeTab()` 先跳过 `active`（卸不掉）和 `audible`（卸了会掐断声音），失败重试一次。

**3 秒还没提交呢？不卸载。** 这是刻意留的刹车：地址没落定就卸载，标签会退化成 `about:blank`，
等于把用户存下来的网址弄丢了。这时候宁可让它继续加载——多占一点内存，比丢数据强。
返回值里 `slow` 就是这类"没敢冻结"的计数，提示语会单独说一句。

**操作队列不是免费的**：`tabs.create` 一返回就放下一个，限住的只是"创建"这个动作，
标签还是会被瞬间建出来并全部并行加载。所以"不冻结"模式下也必须等到 `status === 'complete'`
再放下一个（15 秒超时），否则这个队列等于没写。这条是写测试时才发现的。

**失败不阻塞**：某个标签没卸成，只是多占一点内存，标签本身是好的；返回值会区分
"取回 N 个 / 其中 M 个已冻结 / K 个太慢没冻结"。

### 单个取回不走这条路

只有一条时，用户点它就是**想看它**——所以直接 `active: true` 切过去，不冻结、不排队，面板顺手关掉。
批量才走冻结流程。这两个场景混在一起做，会得到一个"点了没反应"的面板。

### 怎么验证的（不用开浏览器）

`tools/test_restore.js` 把 `chrome.*` 整个换成假对象，用 `vm` 在新上下文里加载 `background.js`，
截住它注册的 `onMessage` 监听器，然后真的发一条 `RESTORE` 消息。断言的是行为，不是实现：

- 并发峰值 ≤ 3，而且**确实用满**（防止退化成串行）
- 每个标签都在"提交后"才被卸载
- 提交永远不来的那种，**一个都不许卸**（防 `about:blank`）
- 单个取回不冻结；关闭冻结时并发上限放宽到 6
- 抽屉最终清空、标签组被重建

```
node tools/test_restore.js
```

上面那两个坑（并发限不住、超时误卸载）都是这个壳子先发现的，不是靠读代码看出来的。
它比装 Playwright 轻得多，改完 `background.js` 随手跑一下就行。

## 六、目录结构

```
tab-drawer/
├── manifest.json      # 扩展的"身份证"：权限、入口、快捷键都在这里
├── background.js      # Service Worker：所有写操作（收/取/删/休眠）+ 定时器
├── popup.html         # 面板骨架
├── popup.css          # 面板样式
├── popup.js           # 面板逻辑：api 层 / render 层 / handlers 层
├── icons/             # 图标（由 tools/make_icons.py 生成）
├── docs/              # README 用的界面截图（screenshot*.png）
├── tools/
│   ├── make_icons.py  # 纯标准库生成 PNG 图标
│   ├── build_preview.py # 把三个文件合成 preview.html
│   └── test_restore.js  # 用假 chrome 验证取回逻辑（node tools/test_restore.js）
└── preview.html       # 产物，用来在普通浏览器里预览界面
```

## 七、几个关键设计决定（这几条比代码本身值钱）

**1. 为什么写操作放在 Service Worker，不放 popup？**
popup 的本质是一个随时会被销毁的网页。鼠标移开、切个窗口，它立刻被回收，正在跑的
`await` 会被直接掐断。收 30 个标签是「读列表 → 存 storage → 关标签」三步，断在中间就会
得到"标签关了一半、抽屉里却没存"的状态。Service Worker 的生命周期由浏览器管理，能把
一整段异步跑完。所以 popup 只负责发消息，`background.js` 负责干活。

**2. 为什么不用 `chrome.tabs.query({currentWindow: true})`？**
Service Worker 里没有"当前窗口"，`currentWindow` 会退化成"最后获得焦点的窗口"，行为不
确定。所以显式取 `chrome.windows.getLastFocused({windowTypes:['normal']})` 的 id 再按
`windowId` 查。

**3. 休眠 vs 关闭，区别在哪？**
`chrome.tabs.discard()` 只释放渲染进程，`tab.discarded` 变 true，标签还在标签栏。
页面重新激活时会**重新加载**——所以未提交的表单内容会丢。这就是为什么默认"不打扰固定
标签""不打扰正在出声的标签"，以及为什么自动休眠默认是**关**的：这类功能最容易在你不知情
的时候弄丢东西。

**4. 去重策略**
同一个 URL 已经在抽屉里就不再存第二条，否则反复收纳会把抽屉灌成一堆重复项。

**5. 为什么 popup.js 里有一层 `api` 适配层？**
有扩展环境时走 `chrome.runtime.sendMessage`，没有时走内存假数据。好处有两个：一是这个
页面能脱离扩展单独预览/调样式，二是以后要把存储从 `chrome.storage` 换成 IndexedDB 或云端，
只改 `api` 一处。

**6. 标签组是"快照"，不是"引用"**
抽屉里存的是 `{title, color}` 这份快照，不是原 `groupId`。因为原组在你收纳完就消失了
（空组会被浏览器自动回收），groupId 没有跨会话的意义。取回时按"同名同色"重新成组，
所以同名不同色的两个组不会被合并。

**7. 单个收纳不新增 API**
`STASH_TABS` 一开始就接受数组，单个收纳只是传一个元素的数组。`Alt+Shift+A` 之所以能做到
"连按即逐个"，不是因为我们实现了拾取模式，而是因为**关掉当前标签后浏览器会自动激活相邻
标签**——把系统的默认行为用上，比自己造一套状态机稳得多。

**8. `[hidden]` 打不过 `display:flex`**
项目里多个容器是 `display:flex`，JS 里 `el.hidden = true` 会失效（UA 的 `[hidden]{display:none}`
优先级低于类选择器）。所以 CSS 顶部加了一条 `[hidden]{display:none !important}` 兜底。

## 八、数据结构

```js
// chrome.storage.local
{
  collection: [
    {
      id: "uuid",
      title: "页面标题",
      url: "https://...",
      favIconUrl: "https://...",
      savedAt: 1761...,
      group: { title: "测试大赛", color: "blue" } // 不在标签组里时为 null
    }
  ],
  settings: {
    autoSuspend: false,   // 是否自动休眠
    idleMinutes: 30,      // 闲置多久算闲置
    skipPinned: true,     // 不动固定标签
    skipAudible: true,    // 不动出声的标签
    rebuildGroups: true,  // 取回时重建标签组
    groupBy: "time",      // 面板列表默认分组：time | site | group
    lazyRestore: true,    // 批量取回时并发建、建好即卸载
    restoreInNewWindow: false // 取回时开新窗口
  }
}
```

权限申请了五个：`tabs`（读写标签、discard）、`storage`（存抽屉）、`alarms`（定时扫描）、
`tabGroups`（读组名/颜色、取回时建组）、`contextMenus`（右键菜单）。
**没有申请任何 host 权限**，也就是说这个扩展读不到任何网页内容。

## 九、可以继续做的方向

1. **云同步**：`chrome.storage.sync` 有 8 KB/项、100 KB 总量限制，抽屉很容易超；正解是
   自己搭个后端或者用 `storage.local` + 手写导出/导入 JSON。
2. **真正的内存数字**：`chrome.processes` API 能读到每个标签的内存占用，但需要在
   `chrome://flags` 打开实验特性，不能上架商店。商店版只能给"休眠了 N 个"这种计数。
3. **导入 OneTab/Toby 的导出文件**，抢第一批用户的迁移成本最低。
4. **AI 自动归堆**：把标题丢给模型分成 3~5 个主题，一天结束前给你一份"今天开了 47 个，
   建议留这 6 个"。
5. **完整 PSL**：把站点键的小抄换成 Public Suffix List 数据表，顺手解决 `github.io`
   这类公共后缀被当成站点的情况。

## 已完成

- [x] 按域名聚类（时间 / 站点 / 标签组三档切换，分组可折叠）
- [x] 和标签组配合（收纳记组名与颜色，取回自动重建）
- [x] 单个 / 逐个标签收纳（行内按钮、右键菜单、`Alt+Shift+A` 连按）
- [x] 标签栏右键 + 多选标签一次收（Chrome 150+）
- [x] 批量取回先冻结（并发 3 + 提交后卸载，点开才加载）

## 十、调试备忘

- Service Worker 日志：`chrome://extensions` → 找到本扩展 → 点「Service Worker」。
- 改了 `background.js` 必须点扩展卡片上的刷新按钮，改 `popup.*` 只需重开面板。
- 面板里看不到 console？右键面板 → 检查。
- 想直接进某个视图调样式：`preview.html#tabs`、`preview.html#site`、`preview.html#group`、`preview.html#settings`。
- 图标重生成：`python tools/make_icons.py`
- 预览页重生成：`python tools/build_preview.py`
- 取回逻辑自测（改 `background.js` 后必跑）：`node tools/test_restore.js`

---

[MIT License](LICENSE) © 2026 mikoi6
