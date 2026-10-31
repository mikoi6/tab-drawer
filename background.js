/**
 * TabDrawer · 后台 Service Worker
 *
 * 为什么所有"写操作"都放这里，而不是放在 popup 里？
 * popup 是一个会被销毁的网页：鼠标一移开、点别处，它立刻被回收，
 * 正在跑的 await 会被拦腰剪断。而收 30 个标签是"读 → 存 → 关"三步，
 * 中途断掉就会得到一个只关了一半、还没存进抽屉的致命状态。
 * Service Worker 的生命周期由浏览器管，能安全跑完一整段异步流程。
 */

const DEFAULTS = {
  collection: [],
  settings: {
    autoSuspend: false,
    idleMinutes: 30,
    skipPinned: true,
    skipAudible: true
  }
};

// 这些页面不能关 / 不能休眠（浏览器内部页）
const PRIVILEGED = /^(chrome|edge|about|devtools|chrome-extension|view-source|chrome-search):/i;

const ALARM_NAME = 'tabdrawer-sweep';

/* ---------------- 存储读写 ---------------- */

async function readState() {
  const raw = await chrome.storage.local.get(DEFAULTS);
  return {
    collection: Array.isArray(raw.collection) ? raw.collection : [],
    settings: { ...DEFAULTS.settings, ...(raw.settings || {}) }
  };
}

async function saveCollection(collection) {
  await chrome.storage.local.set({ collection });
  await refreshBadge(collection.length);
}

async function refreshBadge(count) {
  const n = typeof count === 'number' ? count : (await readState()).collection.length;
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  await chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? '99+' : String(n)) : '' });
}

/* ---------------- 核心动作 ---------------- */

/** 把一批标签页收进抽屉：存元数据 → 关标签 */
async function stashTabs(tabIds) {
  const unique = [...new Set(tabIds)];
  const tabs = (await Promise.all(
    unique.map((id) => chrome.tabs.get(id).catch(() => null))
  )).filter((t) => t && t.url && !PRIVILEGED.test(t.url));

  if (!tabs.length) return { ok: true, count: 0, skipped: 0 };

  const { collection } = await readState();
  const seen = new Set(collection.map((i) => i.url));
  const now = Date.now();
  const fresh = [];

  for (const t of tabs) {
    // 同一个网址已经在抽屉里就不再重复记一条
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    fresh.push({
      id: crypto.randomUUID(),
      title: t.title || t.url,
      url: t.url,
      favIconUrl: t.favIconUrl || '',
      savedAt: now
    });
  }

  if (fresh.length) await saveCollection([...fresh, ...collection]);
  await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  return { ok: true, count: fresh.length, skipped: tabs.length - fresh.length };
}

/**
 * Service Worker 里没有"当前窗口"这个概念，直接 query({currentWindow:true})
 * 拿到的是最后获得焦点的窗口，行为不够确定。所以显式取一次 normal 窗口的 id。
 */
async function targetWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win && win.id;
  } catch (_) {
    return undefined;
  }
}

async function queryWindowTabs() {
  const windowId = await targetWindowId();
  const query = typeof windowId === 'number' ? { windowId } : { currentWindow: true };
  return chrome.tabs.query(query);
}

/** 收起当前窗口除"正在看的这一页"以外的全部标签 */
async function stashCurrentWindow() {
  const tabs = await queryWindowTabs();
  const ids = tabs.filter((t) => !t.active && !PRIVILEGED.test(t.url || '')).map((t) => t.id);
  return stashTabs(ids);
}

/** 从抽屉取回：新开标签（后台打开，不抢焦点）并从抽屉移除 */
async function restoreItems(ids) {
  const { collection } = await readState();
  const wanted = new Set(ids);
  const targets = collection.filter((i) => wanted.has(i.id));
  if (!targets.length) return { ok: true, count: 0 };

  for (const item of targets) {
    try {
      await chrome.tabs.create({ url: item.url, active: false });
    } catch (_) {
      // 单个失败不影响其它
    }
  }
  await saveCollection(collection.filter((i) => !wanted.has(i.id)));
  return { ok: true, count: targets.length };
}

async function deleteItems(ids) {
  const wanted = new Set(ids);
  const { collection } = await readState();
  const next = collection.filter((i) => !wanted.has(i.id));
  await saveCollection(next);
  return { ok: true, count: collection.length - next.length };
}

/**
 * 休眠：把后台标签的渲染进程释放掉，标签还在，点一下才重新加载。
 * idleMinutes = 0 表示"所有后台标签，立刻"。
 */
async function suspendIdle(idleMinutes) {
  const { settings } = await readState();
  const threshold = Math.max(0, idleMinutes ?? settings.idleMinutes) * 60 * 1000;
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  let count = 0;

  for (const t of tabs) {
    if (t.active || t.discarded) continue;
    if (settings.skipPinned && t.pinned) continue;
    if (settings.skipAudible && t.audible) continue;
    if (PRIVILEGED.test(t.url || '')) continue;
    if (t.lastAccessed && now - t.lastAccessed < threshold) continue;
    try {
      await chrome.tabs.discard(t.id);
      count++;
    } catch (_) {
      // 有些标签不允许 discard（比如正在被 DevTools 附着），跳过
    }
  }
  return { ok: true, count };
}

/* ---------------- 定时器 ---------------- */

async function syncAlarm(settings) {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (settings.autoSuspend) {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 5 });
    }
  } else if (existing) {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

/* ---------------- 消息路由 ---------------- */

async function handleMessage(msg) {
  switch (msg && msg.type) {
    case 'GET_STATE': {
      const { collection, settings } = await readState();
      const tabs = await queryWindowTabs();
      return {
        ok: true,
        collection,
        settings,
        tabCount: tabs.length,
        stashableCount: tabs.filter((t) => !t.active && !PRIVILEGED.test(t.url || '')).length,
        suspendedCount: tabs.filter((t) => t.discarded).length
      };
    }
    case 'STASH_WINDOW':
      return stashCurrentWindow();
    case 'STASH_TABS':
      return stashTabs(msg.tabIds || []);
    case 'RESTORE':
      return restoreItems(msg.ids || []);
    case 'DELETE':
      return deleteItems(msg.ids || []);
    case 'DELETE_ALL':
      return deleteItems((await readState()).collection.map((i) => i.id));
    case 'SUSPEND_ALL':
      return suspendIdle(0);
    case 'SAVE_SETTINGS': {
      const { settings } = await readState();
      const next = { ...settings, ...(msg.settings || {}) };
      await chrome.storage.local.set({ settings: next });
      await syncAlarm(next);
      return { ok: true, settings: next };
    }
    default:
      return { ok: false, error: 'unknown message: ' + (msg && msg.type) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // 保持消息通道打开，等异步结果
});

/* ---------------- 生命周期 ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  const raw = await chrome.storage.local.get(['collection', 'settings']);
  const patch = {};
  if (!Array.isArray(raw.collection)) patch.collection = [];
  if (!raw.settings) patch.settings = DEFAULTS.settings;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);

  const { settings } = await readState();
  await syncAlarm(settings);
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  const { settings } = await readState();
  await syncAlarm(settings);
  await refreshBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const { settings } = await readState();
  if (settings.autoSuspend) await suspendIdle(settings.idleMinutes);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'stash-window') await stashCurrentWindow();
  if (command === 'suspend-background') await suspendIdle(0);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.collection) {
    const next = changes.collection.newValue || [];
    refreshBadge(next.length);
  }
});
