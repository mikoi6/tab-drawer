# TabDrawer · 标签抽屉

![界面预览](docs/screenshot.png)

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

- `Alt+Shift+S` 把当前窗口其他标签收进抽屉
- `Alt+Shift+D` 立即休眠所有后台标签

## 三、目录结构

```
tab-drawer/
├── manifest.json      # 扩展的"身份证"：权限、入口、快捷键都在这里
├── background.js      # Service Worker：所有写操作（收/取/删/休眠）+ 定时器
├── popup.html         # 面板骨架
├── popup.css          # 面板样式
├── popup.js           # 面板逻辑：api 层 / render 层 / handlers 层
├── icons/             # 图标（由 tools/make_icons.py 生成）
├── docs/screenshot.png# README 用的界面截图
├── tools/
│   ├── make_icons.py  # 纯标准库生成 PNG 图标
│   └── build_preview.py # 把三个文件合成 preview.html
└── preview.html       # 产物，用来在普通浏览器里预览界面
```

## 四、几个关键设计决定（这几条比代码本身值钱）

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

## 五、数据结构

```js
// chrome.storage.local
{
  collection: [
    { id: "uuid", title: "页面标题", url: "https://...", favIconUrl: "https://...", savedAt: 1761... }
  ],
  settings: {
    autoSuspend: false,   // 是否自动休眠
    idleMinutes: 30,      // 闲置多久算闲置
    skipPinned: true,     // 不动固定标签
    skipAudible: true     // 不动出声的标签
  }
}
```

权限只申请了三个：`tabs`（读写标签的标题/URL、discard）、`storage`（存抽屉）、`alarms`
（定时扫描）。**没有申请任何 host 权限**，也就是说这个扩展读不到任何网页内容。

## 六、可以继续做的方向

1. **按域名聚类**：同一站点的 N 个标签折叠成一条「zhihu.com · 7」，视觉收益巨大。
2. **云同步**：`chrome.storage.sync` 有 8 KB/项、100 KB 总量限制，抽屉很容易超；正解是
   自己搭个后端或者用 `storage.local` + 手写导出/导入 JSON。
3. **真正的内存数字**：`chrome.processes` API 能读到每个标签的内存占用，但需要在
   `chrome://flags` 打开实验特性，不能上架商店。商店版只能给"休睡了 N 个"这种计数。
4. **和标签组配合**：`chrome.tabGroups`，收纳时保留原来的分组和颜色。
5. **导入 OneTab/Toby 的导出文件**，抢第一批用户的迁移成本最低。
6. **AI 自动归堆**：把标题丢给模型分成 3~5 个主题，一天结束前给你一份"今天开了 47 个，
   建议留这 6 个"。

## 七、调试备忘

- Service Worker 日志：`chrome://extensions` → 找到本扩展 → 点「Service Worker」。
- 改了 `background.js` 必须点扩展卡片上的刷新按钮，改 `popup.*` 只需重开面板。
- 面板里看不到 console？右键面板 → 检查。
- 图标重生成：`python tools/make_icons.py`
- 预览页重生成：`python tools/build_preview.py`

---

[MIT License](LICENSE) © 2026 mikoi6
