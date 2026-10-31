/**
 * 在 Node 里验证 background.js 的批量取回逻辑（不启动浏览器）
 *
 * 思路：把 `chrome.*` 整个换成假对象，用 vm 在新上下文里执行 background.js，
 * 截住它注册的 onMessage 监听器，然后发一条 RESTORE 消息看它到底做了什么。
 * 这比"读代码觉得没问题"可靠得多，也不需要装 Playwright。
 *
 * 跑法：node tools/test_restore.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

/* ---------------- 假 chrome ---------------- */

function makeHarness(opts) {
  const { itemCount, commitDelayMs = 40, settings = {} } = opts;

  let collection = Array.from({ length: itemCount }, (_, i) => ({
    id: 'item-' + i,
    title: '页面 ' + i,
    url: `https://site${i % 3}.example.com/page/${i}`,
    favIconUrl: '',
    savedAt: Date.now() - i * 1000,
    group: i % 2 === 0 ? { title: '测试组', color: 'blue' } : null
  }));
  const originalCollection = collection.slice();

  const stats = { maxInFlight: 0, inFlight: 0, created: 0, discarded: [], groups: 0 };
  let nextTabId = 100;
  const tabs = new Map();
  let msgListener = null;

  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (msgListener = fn) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      lastError: undefined
    },
    storage: {
      local: {
        get: async () => ({ collection, settings: { ...DEFAULTS, ...settings } }),
        set: async (patch) => {
          if (Array.isArray(patch.collection)) collection = patch.collection;
        }
      },
      onChanged: { addListener: () => {} }
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {}
    },
    windows: {
      getLastFocused: async () => ({ id: 1 }),
      create: async () => ({ id: 9, tabs: [{ id: 999 }] })
    },
    tabs: {
      query: async () => [],
      create: async (props) => {
        const id = nextTabId++;
        const tab = {
          id,
          url: '',
          pendingUrl: props.url,
          status: 'loading',
          active: !!props.active,
          discarded: false,
          audible: false,
          windowId: props.windowId || 1,
          groupId: -1
        };
        tabs.set(id, tab);
        stats.created++;
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        setTimeout(() => {
          // 模拟"导航提交"：地址落实、pendingUrl 清空
          tab.url = props.url;
          tab.pendingUrl = undefined;
          tab.status = 'complete';
          stats.inFlight--;
        }, commitDelayMs);
        return { ...tab };
      },
      get: async (id) => {
        const t = tabs.get(id);
        if (!t) throw new Error('No tab with id ' + id);
        return { ...t };
      },
      discard: async (id) => {
        const t = tabs.get(id);
        if (!t) throw new Error('No tab with id ' + id);
        if (t.active) throw new Error('Cannot discard active tab');
        t.discarded = true;
        stats.discarded.push(id);
      },
      remove: async () => {},
      group: async ({ tabIds }) => {
        stats.groups++;
        return 1;
      }
    },
    tabGroups: {
      get: async () => ({ title: '测试组', color: 'blue' }),
      update: async () => {}
    },
    alarms: { get: async () => null, create: () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    contextMenus: { removeAll: (cb) => cb && cb(), create: (p, cb) => cb && cb(), onClicked: { addListener: () => {} } }
  };

  const sandbox = {
    chrome,
    crypto: require('crypto').webcrypto,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'background.js' });

  const send = (msg) =>
    new Promise((resolve) => {
      msgListener(msg, {}, resolve);
    });

  return { send, stats, collection: originalCollection, chrome };
}

const DEFAULTS = {
  autoSuspend: false,
  idleMinutes: 30,
  skipPinned: true,
  skipAudible: true,
  rebuildGroups: true,
  groupBy: 'time',
  lazyRestore: true,
  restoreInNewWindow: false
};

/* ---------------- 断言 ---------------- */

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

async function testBatch() {
  console.log('\n[批量取回：并发上限 + 提交后卸载]');
  const N = 9;
  const h = makeHarness({ itemCount: N });
  const ids = h.collection.map((i) => i.id);
  const res = await h.send({ type: 'RESTORE', ids });

  check('全部取回成功', res.count === N, `count=${res.count}`);
  check('并发从未超过 3', h.stats.maxInFlight <= 3, `maxInFlight=${h.stats.maxInFlight}`);
  check('并发确实被用满（真的并行而不是串行）', h.stats.maxInFlight === 3, `maxInFlight=${h.stats.maxInFlight}`);
  check('每个标签都被卸载', h.stats.discarded.length === N, `discarded=${h.stats.discarded.length}`);
  check('返回值里 frozen 与实际一致', res.frozen === N, `frozen=${res.frozen}`);
  check('同组的项重建了组', h.stats.groups === 1, `groups=${h.stats.groups}`);

  const left = await h.send({ type: 'GET_STATE' });
  check('抽屉已被清空', left.collection.length === 0, `left=${left.collection.length}`);
}

async function testSingle() {
  console.log('\n[单个取回：直接切过去，不冻结]');
  const h = makeHarness({ itemCount: 3, settings: { lazyRestore: true } });
  const res = await h.send({ type: 'RESTORE', ids: ['item-1'] });

  check('只取回 1 个', res.count === 1, `count=${res.count}`);
  check('没有被卸载', h.stats.discarded.length === 0, `discarded=${h.stats.discarded.length}`);
  check('新标签是活动标签', h.stats.created === 1 && res.frozen === 0, `frozen=${res.frozen}`);
}

async function testLazyOff() {
  console.log('\n[关闭"先冻结"：只排队，不卸载]');
  const h = makeHarness({ itemCount: 8, settings: { lazyRestore: false } });
  const res = await h.send({ type: 'RESTORE', ids: h.collection.map((i) => i.id) });

  check('全部取回', res.count === 8, `count=${res.count}`);
  check('没有任何卸载', h.stats.discarded.length === 0, `discarded=${h.stats.discarded.length}`);
  check('并发上限放宽到 6', h.stats.maxInFlight <= 6 && h.stats.maxInFlight > 3, `maxInFlight=${h.stats.maxInFlight}`);
}

async function testSlowCommit() {
  console.log('\n[提交超时：宁可继续加载，也不丢地址]');
  const h = makeHarness({ itemCount: 3, commitDelayMs: 4000 });
  const res = await h.send({ type: 'RESTORE', ids: h.collection.map((i) => i.id) });

  check('3 个都取回了', res.count === 3, `count=${res.count}`);
  check('一个都没卸载（未提交就卸载会变成 about:blank）', h.stats.discarded.length === 0, `discarded=${h.stats.discarded.length}`);
  check('超时的被单独计数', res.slow === 3, `slow=${res.slow}`);
  check('抽屉照样清空（标签已经建出来了）', res.count + res.failed === 3);
}

(async () => {
  await testBatch();
  await testSingle();
  await testLazyOff();
  await testSlowCommit();

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
