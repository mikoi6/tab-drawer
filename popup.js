/**
 * TabDrawer · 弹窗界面
 *
 * 结构上分三层，方便你以后替换任意一层：
 *   api      —— 数据通道。有扩展环境就走消息；没有就走内存假数据（所以这个页面
 *               单独用浏览器打开也能看到完整界面，方便调样式）。
 *   render   —— 纯展示，只读 data / ui 两个对象，不碰任何浏览器 API。
 *   handlers —— 用户操作，调 api 然后 refresh()。
 */

/* ================= 1. 环境探测 ================= */

const HAS_CHROME =
  typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

/* ================= 2. 数据通道 ================= */

const realApi = {
  getState: () => chrome.runtime.sendMessage({ type: 'GET_STATE' }),
  getWindowTabs: () => chrome.runtime.sendMessage({ type: 'GET_WINDOW_TABS' }),
  stashWindow: () => chrome.runtime.sendMessage({ type: 'STASH_WINDOW' }),
  stashActive: () => chrome.runtime.sendMessage({ type: 'STASH_ACTIVE' }),
  stashTabs: (tabIds) => chrome.runtime.sendMessage({ type: 'STASH_TABS', tabIds }),
  suspendAll: () => chrome.runtime.sendMessage({ type: 'SUSPEND_ALL' }),
  restore: (ids) => chrome.runtime.sendMessage({ type: 'RESTORE', ids }),
  remove: (ids) => chrome.runtime.sendMessage({ type: 'DELETE', ids }),
  clear: () => chrome.runtime.sendMessage({ type: 'DELETE_ALL' }),
  focusTab: (tabId) => chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId }),
  saveSettings: (settings) =>
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings })
};

// 预览模式用的假数据：只为了让界面在普通网页里也能渲染出来
function createDemoApi() {
  const H = 3600 * 1000;
  const D = 24 * H;
  const now = Date.now();

  const collection = [
    { id: 'a1', title: 'Promise - JavaScript | MDN', url: 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise', savedAt: now - 0.3 * H },
    { id: 'a2', title: 'chrome.tabs API 参考文档', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs', savedAt: now - 1.2 * H },
    { id: 'a3', title: '【全国大学生软件测试大赛】Web 应用测试赛项规程', url: 'https://www.example-contest.cn/rules/web', savedAt: now - 3 * H, group: { title: '测试大赛', color: 'blue' } },
    { id: 'a4', title: 'Playwright 官方文档 · Locators 定位器', url: 'https://playwright.dev/docs/locators', savedAt: now - 1 * D },
    { id: 'a5', title: '如何用 Service Worker 处理长时间任务', url: 'https://web.dev/articles/service-workers', savedAt: now - 2 * D },
    { id: 'a6', title: '广州大学教务系统 - 选课', url: 'https://jw.gzhu.edu.cn/course/select', savedAt: now - 5 * D },
    { id: 'a7', title: 'OneTab 的产品设计思路分析', url: 'https://www.notion.so/onetab-analysis', savedAt: now - 12 * D },
    { id: 'a8', title: '知乎 · 前端如何系统地学', url: 'https://www.zhihu.com/question/1001', savedAt: now - 2 * H },
    { id: 'a9', title: '知乎 · 标签页管理插件推荐', url: 'https://www.zhihu.com/question/1002', savedAt: now - 30 * H }
  ];

  const tabs = [
    { id: 1, title: 'mikoi6/tab-drawer: 标签抽屉', url: 'https://github.com/mikoi6/tab-drawer', active: true, pinned: false, discarded: false, audible: false, group: null },
    { id: 2, title: 'Promise - JavaScript | MDN', url: 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise', active: false, pinned: false, discarded: false, audible: false, group: { title: '前端文档', color: 'blue' } },
    { id: 3, title: 'Array.prototype.map() - MDN', url: 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/map', active: false, pinned: false, discarded: false, audible: false, group: { title: '前端文档', color: 'blue' } },
    { id: 4, title: '如何评价 2026 年的前端就业环境', url: 'https://www.zhihu.com/question/2001', active: false, pinned: false, discarded: false, audible: false, group: null },
    { id: 5, title: '前端如何系统地学？', url: 'https://www.zhihu.com/question/2002', active: false, pinned: false, discarded: true, audible: false, group: null },
    { id: 6, title: '浏览器标签页管理插件推荐', url: 'https://www.zhihu.com/question/2003', active: false, pinned: false, discarded: false, audible: false, group: null },
    { id: 7, title: 'Playwright 官方文档 · Locators', url: 'https://playwright.dev/docs/locators', active: false, pinned: false, discarded: false, audible: false, group: null },
    { id: 8, title: 'Playwright · Auto-waiting', url: 'https://playwright.dev/docs/actionability', active: false, pinned: false, discarded: false, audible: false, group: null },
    { id: 9, title: '软测大赛备考 · 合集', url: 'https://www.bilibili.com/video/BV1xx411c7mD', active: false, pinned: false, discarded: false, audible: false, group: null },
    { id: 10, title: '广州大学教务系统', url: 'https://jw.gzhu.edu.cn/course/select', active: false, pinned: true, discarded: false, audible: false, group: null }
  ];

  const state = {
    collection,
    settings: {
      autoSuspend: true,
      idleMinutes: 30,
      skipPinned: true,
      skipAudible: true,
      rebuildGroups: true,
      groupBy: 'time'
    },
    tabCount: tabs.length,
    stashableCount: tabs.filter((t) => !t.active).length,
    suspendedCount: tabs.filter((t) => t.discarded).length
  };

  const demoNote = { ok: true, demo: true, count: 0 };
  return {
    getState: async () => ({ ok: true, ...state }),
    getWindowTabs: async () => ({ ok: true, tabs }),
    stashWindow: async () => demoNote,
    stashActive: async () => demoNote,
    stashTabs: async () => demoNote,
    suspendAll: async () => demoNote,
    restore: async () => demoNote,
    remove: async () => demoNote,
    clear: async () => demoNote,
    focusTab: async () => demoNote,
    saveSettings: async (s) => {
      state.settings = { ...state.settings, ...s };
      return { ok: true, settings: state.settings };
    }
  };
}

const api = HAS_CHROME ? realApi : createDemoApi();

/* ================= 3. 小工具 ================= */

const $ = (sel) => document.querySelector(sel);

const GROUP_COLORS = {
  grey: '#8f95ab',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#12b5cb',
  orange: '#fa903e'
};

// 常见的二级后缀：判断"可注册域名"时要多看一段，否则 gzhu.edu.cn 会被切成 edu.cn
const MULTI_SUFFIX = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp',
  'com.hk', 'com.tw', 'com.au', 'co.kr', 'com.sg', 'co.nz', 'com.br'
]);

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return String(url || '').slice(0, 40);
  }
}

/**
 * 站点键：把同一站点的不同页面归到一起。
 * 这不是完整的 Public Suffix List，而是一份够用的小抄——真要做到零误判，
 * 得引入完整 PSL 数据表，对个人项目来说性价比不高。
 */
function siteKeyOf(url) {
  const host = hostOf(url);
  if (!host || /^[\d.]+$/.test(host) || host === 'localhost') return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIX.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

function bucketOf(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  if (Date.now() - ts < 7 * 86400000) return '最近 7 天';
  return '更早';
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 1900);
}

/** 带高亮的文本节点（避免用 innerHTML 拼标题，防止标题里带 HTML 标签搞坏页面） */
function highlighted(text, keyword) {
  const frag = document.createDocumentFragment();
  if (!keyword) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  const k = keyword.toLowerCase();
  let from = 0;
  let idx = lower.indexOf(k);
  while (idx !== -1) {
    if (idx > from) frag.append(text.slice(from, idx));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + k.length);
    frag.append(mark);
    from = idx + k.length;
    idx = lower.indexOf(k, from);
  }
  if (from < text.length) frag.append(text.slice(from));
  return frag;
}

function svgIcon(d, size, stroke) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', stroke || 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/* ================= 4. 状态 ================= */

let data = {
  collection: [],
  tabs: [],
  settings: {
    autoSuspend: false,
    idleMinutes: 30,
    skipPinned: true,
    skipAudible: true,
    rebuildGroups: true,
    groupBy: 'time'
  },
  tabCount: 0,
  stashableCount: 0,
  suspendedCount: 0
};

const ui = {
  tab: 'drawer', // drawer | tabs
  groupBy: 'time', // time | site
  keyword: '',
  collapsed: new Set() // 折叠的分组 key
};

// 调试用：popup.html#tabs / #site（preview.html 同理）可以直接进指定视图，
// 方便截图和调样式。带 #site 时不再用存储里的分组偏好覆盖它。
const HASH = location.hash || '';
if (HASH.includes('tabs')) ui.tab = 'tabs';
if (HASH.includes('site')) ui.groupBy = 'site';

/* ================= 5. 渲染 ================= */

function render() {
  $('#subline').textContent = `本窗口 ${data.tabCount} 个标签 · 已休眠 ${data.suspendedCount}`;
  $('#segDrawer').textContent = data.collection.length;
  $('#segTabs').textContent = data.tabCount;

  const stashBtn = $('#btnStash');
  stashBtn.textContent =
    data.stashableCount > 0 ? `收进抽屉（${data.stashableCount}）` : '收进抽屉';
  stashBtn.disabled = data.stashableCount === 0;

  const isDrawer = ui.tab === 'drawer';
  $('#modeToggle').hidden = !isDrawer;
  $('#drawerActions').hidden = !isDrawer;

  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('on', btn.dataset.view === ui.tab);
  }
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('on', btn.dataset.mode === ui.groupBy);
  }

  if (isDrawer) renderDrawer();
  else renderTabsView();
}

/* ---- 抽屉视图 ---- */

function renderDrawer() {
  const kw = ui.keyword.trim().toLowerCase();
  const items = data.collection
    .filter(
      (i) =>
        !kw ||
        i.title.toLowerCase().includes(kw) ||
        i.url.toLowerCase().includes(kw)
    )
    .sort((a, b) => b.savedAt - a.savedAt);

  $('#listCount').textContent = kw
    ? `找到 ${items.length} 项`
    : `共 ${data.collection.length} 项`;

  if (!items.length) {
    if (data.collection.length) showEmpty('没有匹配的内容', '换个关键词试试，或者清空搜索框。');
    else showEmpty('抽屉是空的', '点上面的「收进抽屉」，把这一刻不想看的标签先存起来。');
    return;
  }

  paintGroups(buildDrawerGroups(items), 'drawer');
}

/** 抽屉列表的分组：按时间桶，或按站点 */
function buildDrawerGroups(items) {
  if (ui.groupBy === 'site') {
    const map = new Map();
    for (const it of items) {
      const key = siteKeyOf(it.url);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([site, arr]) => ({
        key: 'site:' + site,
        label: site,
        icon: arr[0].favIconUrl || '',
        items: arr.sort((x, y) => y.savedAt - x.savedAt)
      }));
  }

  const map = new Map();
  for (const it of items) {
    const key = bucketOf(it.savedAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const order = ['今天', '昨天', '最近 7 天', '更早'];
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([label, arr]) => ({
      key: 'time:' + label,
      label,
      icon: '',
      items: arr.sort((x, y) => y.savedAt - x.savedAt)
    }));
}

/* ---- 本窗标签视图 ---- */

function renderTabsView() {
  const kw = ui.keyword.trim().toLowerCase();
  const tabs = data.tabs.filter(
    (t) =>
      !kw || t.title.toLowerCase().includes(kw) || t.url.toLowerCase().includes(kw)
  );

  $('#listCount').textContent = kw
    ? `找到 ${tabs.length} 个标签`
    : `${data.tabs.length} 个标签 · 点右侧收纳`;

  if (!tabs.length) {
    showEmpty('没有匹配的标签页', '换个关键词试试。');
    return;
  }

  const map = new Map();
  for (const t of tabs) {
    const key = siteKeyOf(t.url);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  const groups = [...map.entries()]
    .map(([site, arr]) => ({
      key: 'site:' + site,
      label: site,
      icon: arr[0].favIconUrl || '',
      // 当前页所在的站点排最前：你打开面板时多半就是想看它周围的标签
      hasActive: arr.some((t) => t.active),
      items: arr.sort(
        (x, y) =>
          Number(y.active) - Number(x.active) ||
          Number(y.pinned) - Number(x.pinned) ||
          x.title.localeCompare(y.title)
      )
    }))
    .sort(
      (a, b) =>
        Number(b.hasActive) - Number(a.hasActive) ||
        b.items.length - a.items.length ||
        a.label.localeCompare(b.label)
    );

  paintGroups(groups, 'tabs');
}

/* ---- 分组渲染 ---- */

function paintGroups(groups, mode) {
  const list = $('#list');
  list.replaceChildren();
  $('#empty').hidden = true;
  const kw = ui.keyword.trim();

  for (const g of groups) {
    const collapsed = ui.collapsed.has(g.key);

    const head = document.createElement('div');
    head.className = 'group-head';
    head.dataset.groupKey = g.key;

    const chev = svgIcon('M9 6l6 6-6 6', 12);
    chev.classList.add('chev');
    if (!collapsed) chev.style.transform = 'rotate(90deg)';
    head.append(chev);

    if (g.icon) {
      const img = document.createElement('img');
      img.className = 'group-favicon';
      img.src = g.icon;
      img.alt = '';
      head.append(img);
    }

    const label = document.createElement('span');
    label.className = 'group-label';
    label.textContent = g.label;
    head.append(label);

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(g.items.length);
    head.append(count);

    if (mode === 'tabs' && g.items.length > 1) {
      const bulk = document.createElement('button');
      bulk.className = 'link bulk';
      bulk.dataset.act = 'stash-site';
      bulk.dataset.ids = g.items.map((t) => t.id).join(',');
      bulk.textContent = `收这 ${g.items.length} 个`;
      head.append(bulk);
    }

    list.append(head);
    if (collapsed) continue;

    for (const it of g.items) {
      list.append(mode === 'drawer' ? buildDrawerItem(it, kw) : buildTabItem(it, kw));
    }
  }
}

function faviconOf(item) {
  if (item.favIconUrl) {
    const img = document.createElement('img');
    img.className = 'favicon';
    img.src = item.favIconUrl;
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(avatarOf(item)));
    return img;
  }
  return avatarOf(item);
}

function avatarOf(item) {
  const span = document.createElement('span');
  span.className = 'avatar';
  span.textContent = (hostOf(item.url)[0] || '?').toUpperCase();
  return span;
}

function buildDrawerItem(item, kw) {
  const row = document.createElement('div');
  row.className = 'item';
  row.dataset.act = 'restore';
  row.dataset.id = item.id;
  row.title = `${item.title}\n${item.url}\n点击取回`;

  row.append(faviconOf(item));

  const meta = document.createElement('div');
  meta.className = 'meta';

  const t = document.createElement('div');
  t.className = 'item-title';
  t.append(highlighted(item.title, kw));

  const sub = document.createElement('div');
  sub.className = 'item-host';
  sub.textContent = hostOf(item.url);
  if (item.group) sub.append(groupChip(item.group));

  meta.append(t, sub);
  row.append(meta);

  const del = document.createElement('button');
  del.className = 'del';
  del.dataset.act = 'delete';
  del.dataset.id = item.id;
  del.title = '从抽屉删除';
  del.textContent = '×';
  row.append(del);

  return row;
}

function groupChip(group) {
  const wrap = document.createElement('span');
  wrap.className = 'group-chip';
  const dot = document.createElement('i');
  dot.className = 'dot';
  dot.style.background = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
  const name = document.createElement('span');
  name.textContent = group.title || '未命名组';
  wrap.append(dot, name);
  return wrap;
}

function buildTabItem(tab, kw) {
  const row = document.createElement('div');
  row.className = 'item';
  row.dataset.act = 'focus';
  row.dataset.id = tab.id;
  row.title = `${tab.title}\n${tab.url}` + (tab.active ? '\n（当前页，收纳会关掉它）' : '\n点击跳转到这个标签');

  row.append(faviconOf(tab));

  const meta = document.createElement('div');
  meta.className = 'meta';

  const t = document.createElement('div');
  t.className = 'item-title';
  t.append(highlighted(tab.title, kw));
  meta.append(t);

  // 域名已经在分组标题上写过了，这里只补真正有信息量的状态
  const badges = [];
  if (tab.active) badges.push(tag('当前页', 'on'));
  if (tab.pinned) badges.push(tag('固定'));
  if (tab.discarded) badges.push(tag('已休眠'));
  if (tab.group) badges.push(groupChip(tab.group));

  if (badges.length) {
    const sub = document.createElement('div');
    sub.className = 'item-host';
    for (const b of badges) sub.append(b);
    meta.append(sub);
  }

  row.append(meta);

  const act = document.createElement('button');
  act.className = 'act-btn';
  act.dataset.act = 'stash-tab';
  act.dataset.id = tab.id;
  act.title = tab.active ? '收纳并关闭这个标签' : '收进抽屉';
  act.textContent = '收纳';
  row.append(act);

  return row;
}

function tag(text, kind) {
  const span = document.createElement('span');
  span.className = 'tag' + (kind ? ' ' + kind : '');
  span.textContent = text;
  return span;
}

function showEmpty(title, desc) {
  $('#list').replaceChildren();
  $('#empty').hidden = false;
  $('#emptyTitle').textContent = title;
  $('#emptyDesc').textContent = desc;
}

/* ================= 6. 数据刷新 ================= */

async function refresh() {
  try {
    const res = await api.getState();
    if (!res || res.ok === false) {
      toast('读取失败，请重开面板');
      return;
    }
    data.collection = res.collection || [];
    data.settings = { ...data.settings, ...(res.settings || {}) };
    data.tabCount = res.tabCount ?? data.tabCount;
    data.stashableCount = res.stashableCount ?? 0;
    data.suspendedCount = res.suspendedCount ?? 0;

    // 面板记住上次用的分组方式（除非本次是带 #site 打开的调试视图）
    if (!HASH.includes('site') && (data.settings.groupBy === 'site' || data.settings.groupBy === 'time')) {
      ui.groupBy = data.settings.groupBy;
    }

    if (ui.tab === 'tabs') await loadTabs();
    render();
    syncSettingsUI();
  } catch (err) {
    toast('连接后台失败：' + err.message);
  }
}

async function loadTabs() {
  try {
    const res = await api.getWindowTabs();
    if (res && res.ok) data.tabs = res.tabs || [];
  } catch (_) {
    data.tabs = [];
  }
}

function syncSettingsUI() {
  $('#autoSuspend').checked = !!data.settings.autoSuspend;
  $('#idleMinutes').value = String(data.settings.idleMinutes);
  $('#skipPinned').checked = !!data.settings.skipPinned;
  $('#skipAudible').checked = !!data.settings.skipAudible;
  $('#rebuildGroups').checked = !!data.settings.rebuildGroups;
}

/* ================= 7. 事件 ================= */

// --- 视图切换 ---
for (const btn of document.querySelectorAll('.seg-btn')) {
  btn.addEventListener('click', async () => {
    if (btn.dataset.view === ui.tab) return;
    ui.tab = btn.dataset.view;
    ui.keyword = '';
    $('#q').value = '';
    if (ui.tab === 'tabs') await loadTabs();
    render();
  });
}

// --- 分组方式切换（记进 settings，下次打开还是这个视角）---
for (const btn of document.querySelectorAll('.mode-btn')) {
  btn.addEventListener('click', async () => {
    ui.groupBy = btn.dataset.mode;
    render();
    await api.saveSettings({ groupBy: ui.groupBy });
  });
}

// --- 主操作 ---
$('#btnStash').addEventListener('click', async () => {
  const res = await api.stashWindow();
  if (res && res.demo) return toast('预览模式：装进浏览器才会真的收纳');
  if (!res || res.ok === false) return toast('收纳失败：' + (res && res.error));
  if (res.count === 0) return toast('这些标签都已经在抽屉里了');
  toast(`已收进 ${res.count} 个标签` + (res.skipped ? `，跳过重复 ${res.skipped} 个` : ''));
  refresh();
});

$('#btnSuspend').addEventListener('click', async () => {
  const res = await api.suspendAll();
  if (res && res.demo) return toast('预览模式：装进浏览器才会真的休眠');
  if (!res || res.ok === false) return toast('操作失败');
  toast(res.count ? `已休眠 ${res.count} 个后台标签` : '没有可休眠的后台标签');
  refresh();
});

// --- 列表：一个委托搞定所有行内操作 ---
$('#list').addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-act]');

  // 站点组头的"收这 N 个"
  if (actEl && actEl.dataset.act === 'stash-site') {
    e.stopPropagation();
    const ids = actEl.dataset.ids.split(',').map(Number);
    const res = await api.stashTabs(ids);
    if (res && res.demo) return toast('预览模式：装进浏览器才会真的收纳');
    toast(`已收进 ${res.count} 个标签`);
    return refresh();
  }

  // 单个标签收纳
  if (actEl && actEl.dataset.act === 'stash-tab') {
    e.stopPropagation();
    const res = await api.stashTabs([Number(actEl.dataset.id)]);
    if (res && res.demo) return toast('预览模式：装进浏览器才会真的收纳');
    toast(res.count ? '已收进 1 个标签' : '已在抽屉里了');
    return refresh();
  }

  // 从抽屉删除
  if (actEl && actEl.dataset.act === 'delete') {
    e.stopPropagation();
    const res = await api.remove([actEl.dataset.id]);
    if (res && res.demo) return toast('预览模式：不会真的删除');
    return refresh();
  }

  // 点分组标题：折叠 / 展开
  const head = e.target.closest('.group-head');
  if (head) {
    const key = head.dataset.groupKey;
    if (ui.collapsed.has(key)) ui.collapsed.delete(key);
    else ui.collapsed.add(key);
    return render();
  }

  // 点抽屉条目：取回
  if (actEl && actEl.dataset.act === 'restore') {
    const res = await api.restore([actEl.dataset.id]);
    if (res && res.demo) return toast('预览模式：装进浏览器才能真的取回');
    toast('已取回，去标签栏看看');
    return refresh();
  }

  // 点标签条目：跳过去
  if (actEl && actEl.dataset.act === 'focus') {
    const res = await api.focusTab(Number(actEl.dataset.id));
    if (res && res.demo) return toast('预览模式：装进浏览器才能跳转');
    window.close();
  }
});

$('#btnRestoreAll').addEventListener('click', async () => {
  const ids = data.collection.map((i) => i.id);
  if (!ids.length) return;
  const res = await api.restore(ids);
  if (res && res.demo) return toast('预览模式：装进浏览器才能真的取回');
  toast(`已取回 ${res.count} 个标签，标签组一并重建`);
  refresh();
});

// 清空是不可逆操作：不用 confirm()（弹窗里弹系统对话框容易把面板一起关掉），
// 改成按钮二次确认——点一次变成"确认清空"，3 秒内再点一次才执行。
let clearArmed = false;
let clearTimer = null;
const clearBtn = $('#btnClear');

function disarmClear() {
  clearArmed = false;
  clearTimer = null;
  clearBtn.textContent = '清空';
  clearBtn.classList.remove('armed');
}

clearBtn.addEventListener('click', async () => {
  if (!data.collection.length) return;
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.textContent = `确认清空 ${data.collection.length} 项？`;
    clearBtn.classList.add('armed');
    clearTimer = setTimeout(disarmClear, 3000);
    return;
  }
  clearTimeout(clearTimer);
  const res = await api.clear();
  disarmClear();
  if (res && res.demo) return toast('预览模式：不会真的清空');
  toast('抽屉已清空');
  refresh();
});

$('#q').addEventListener('input', (e) => {
  ui.keyword = e.target.value;
  render();
});

$('#btnSettings').addEventListener('click', (e) => {
  const panel = $('#settings');
  panel.hidden = !panel.hidden;
  e.currentTarget.classList.toggle('on', !panel.hidden);
});

for (const id of ['autoSuspend', 'skipPinned', 'skipAudible', 'rebuildGroups']) {
  $('#' + id).addEventListener('change', async (e) => {
    await api.saveSettings({ [id]: e.target.checked });
    data.settings[id] = e.target.checked;
  });
}

$('#idleMinutes').addEventListener('change', async (e) => {
  const v = Number(e.target.value);
  await api.saveSettings({ idleMinutes: v });
  data.settings.idleMinutes = v;
});

/* ================= 8. 启动 ================= */

refresh();
