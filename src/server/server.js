/* ══════════════════════════════════════════════════════════════
   server.js — 零依赖云同步服务器(node src/server/server.js 即可运行/部署)

   职责:
   1. 静态托管 PWA(白名单文件)
   2. 账号注册(令牌鉴权,无密码,令牌即身份)
   3. 状态同步:LWW 合并(tasks 整表、records 按单元格、frozen 并集)
   4. 打卡搭子:邀请码配对、伙伴摘要、共同火焰 duo streak
      —— 服务端直接复用 core.js 的领域逻辑

   存储:单 JSON 文件(SYNC_DATA 环境变量可指定路径),原子写盘。
   ══════════════════════════════════════════════════════════════ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('../shared/core.js');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const SHARED_DIR = path.join(ROOT, 'src', 'shared');
const DATA_FILE = process.env.SYNC_DATA || path.join(ROOT, 'server-data.json');

/* ── 持久化 ── */
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_) {
    return { users: {}, codes: {} };
  }
}
function saveDB(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

/* ── 合并:字段级 LWW(导出供单元测试) ──
   state = {tasks:[], records:{date:{tasks:{tid:value}}}, frozen:[dates]}
   meta  = {tasks:ts, cells:{"date|tid":ts}}
   规则:tasks 整表按 meta.tasks 时间戳取新;records 按单元格时间戳取新,
   值为 0/缺失 + 较新时间戳 = 删除墓碑;frozen 只增不减取并集。
   时间戳相同时偏向 client(请求方),保证确定性。 */
function cellValue(state, key) {
  const [date, tid] = key.split('|');
  const v = state.records?.[date]?.tasks?.[tid];
  return typeof v === 'number' ? v : 0;
}
function collectCellKeys(state, meta, into) {
  for (const k of Object.keys(meta.cells || {})) into.add(k);
  for (const [date, rec] of Object.entries(state.records || {})) {
    for (const tid of Object.keys(rec.tasks || {})) into.add(`${date}|${tid}`);
  }
}
function merge(sState, sMeta, cState, cMeta) {
  const out = { tasks: [], records: {}, frozen: [] };
  const meta = { tasks: 0, cells: {} };

  // tasks:整表 LWW,平手偏向 client
  const sT = sMeta.tasks || 0, cT = cMeta.tasks || 0;
  if (cT >= sT) { out.tasks = cState.tasks || []; meta.tasks = cT; }
  else { out.tasks = sState.tasks || []; meta.tasks = sT; }

  // records:单元格 LWW;无 meta 的存量数据按 ts=1 处理(优于"不存在",劣于任何真实时间戳)
  const keys = new Set();
  collectCellKeys(sState, sMeta, keys);
  collectCellKeys(cState, cMeta, keys);
  for (const key of keys) {
    const sTs = (sMeta.cells || {})[key] ?? (cellValue(sState, key) > 0 ? 1 : 0);
    const cTs = (cMeta.cells || {})[key] ?? (cellValue(cState, key) > 0 ? 1 : 0);
    const useClient = cTs >= sTs;
    const ts = useClient ? cTs : sTs;
    const val = useClient ? cellValue(cState, key) : cellValue(sState, key);
    meta.cells[key] = ts;
    if (val > 0) {
      const [date, tid] = key.split('|');
      if (!out.records[date]) out.records[date] = { tasks: {} };
      out.records[date].tasks[tid] = val;
    }
  }

  // frozen:并集(修复不可撤销,天然单调)
  out.frozen = [...new Set([...(sState.frozen || []), ...(cState.frozen || [])])].sort();

  return { state: out, meta };
}

/* ── 领域计算(复用 core.js) ── */
function coreState(u) {
  return {
    tasks: u.state.tasks || [],
    records: u.state.records || {},
    frozen: new Set(u.state.frozen || []),
  };
}
function duoStreak(stA, stB, today) {
  const chain = d => Core.isChainDay(stA, d) && Core.isChainDay(stB, d);
  let s = 0, cur = today;
  while (chain(cur)) { s++; cur = Core.addDays(cur, -1); if (s > 3650) break; }
  if (s === 0) {
    cur = Core.addDays(today, -1);
    while (chain(cur)) { s++; cur = Core.addDays(cur, -1); if (s > 3650) break; }
  }
  return s;
}
function partnerSummary(db, user, today) {
  const partner = user.partnerId ? db.users[user.partnerId] : null;
  if (!partner) return null;
  const stP = coreState(partner);
  const stMe = coreState(user);
  return {
    name: partner.name,
    streak: Core.calcStreak(stP, today),
    todayPerfect: Core.isPerfect(stP, today),
    totalPerfect: Core.totalPerfect(stP),
    duo: duoStreak(stMe, stP, today),
  };
}

/* ── HTTP 基础设施 ── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > 5e6) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function authUser(db, req) {
  const m = /^Bearer\s+([a-f0-9]{32,64})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  return Object.values(db.users).find(u => u.token === m[1]) || null;
}
function sanitizeToday(q) {
  return DATE_RE.test(q || '') ? q : Core.ds(new Date());
}

/* ── 静态文件(白名单) ── */
const STATIC = {
  '/': [RENDERER_DIR, 'index.html', 'text/html; charset=utf-8'],
  '/index.html': [RENDERER_DIR, 'index.html', 'text/html; charset=utf-8'],
  '/daily-checkin.html': [RENDERER_DIR, 'index.html', 'text/html; charset=utf-8'],
  '/core.js': [SHARED_DIR, 'core.js', 'text/javascript; charset=utf-8'],
  '/shared/core.js': [SHARED_DIR, 'core.js', 'text/javascript; charset=utf-8'],
  '/storage.js': [RENDERER_DIR, 'storage.js', 'text/javascript; charset=utf-8'],
  '/renderer.js': [RENDERER_DIR, 'renderer.js', 'text/javascript; charset=utf-8'],
  '/sync.js': [RENDERER_DIR, 'sync.js', 'text/javascript; charset=utf-8'],
  '/sw.js': [RENDERER_DIR, 'sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': [RENDERER_DIR, 'manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': [RENDERER_DIR, 'icon.svg', 'image/svg+xml'],
};

/* ── 应用 ── */
function createApp() {
  const db = loadDB();

  return async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    try {
      /* —— API —— */
      if (p === '/api/register' && req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '').trim().slice(0, 20) || 'Checker';
        const id = crypto.randomBytes(6).toString('hex');
        const token = crypto.randomBytes(16).toString('hex');
        let code;
        do { code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (db.codes[code]);
        db.users[id] = {
          id, name, token, code, partnerId: null,
          state: { tasks: [], records: {}, frozen: [] },
          meta: { tasks: 0, cells: {} },
          updatedAt: Date.now(),
        };
        db.codes[code] = id;
        saveDB(db);
        return json(res, 200, { userId: id, token, code, name });
      }

      if (p === '/api/sync' && req.method === 'POST') {
        const user = authUser(db, req);
        if (!user) return json(res, 401, { error: 'unauthorized' });
        const body = await readBody(req);
        const today = sanitizeToday(body.today);
        const cState = body.state && typeof body.state === 'object' ? body.state : {};
        const cMeta = body.meta && typeof body.meta === 'object' ? body.meta : {};
        const merged = merge(user.state, user.meta, {
          tasks: Array.isArray(cState.tasks) ? cState.tasks : [],
          records: cState.records && typeof cState.records === 'object' ? cState.records : {},
          frozen: Array.isArray(cState.frozen) ? cState.frozen.filter(d => DATE_RE.test(d)) : [],
        }, { tasks: Number(cMeta.tasks) || 0, cells: cMeta.cells || {} });
        user.state = merged.state;
        user.meta = merged.meta;
        user.updatedAt = Date.now();
        saveDB(db);
        return json(res, 200, {
          state: merged.state,
          meta: merged.meta,
          partner: partnerSummary(db, user, today),
          code: user.code,
          name: user.name,
        });
      }

      if (p === '/api/pair' && req.method === 'POST') {
        const user = authUser(db, req);
        if (!user) return json(res, 401, { error: 'unauthorized' });
        const body = await readBody(req);
        const code = String(body.code || '').trim().toUpperCase();
        const targetId = db.codes[code];
        const target = targetId ? db.users[targetId] : null;
        if (!target) return json(res, 404, { error: 'code not found' });
        if (target.id === user.id) return json(res, 400, { error: 'cannot pair with self' });
        if (user.partnerId && user.partnerId !== target.id) return json(res, 409, { error: 'already paired' });
        if (target.partnerId && target.partnerId !== user.id) return json(res, 409, { error: 'partner already paired' });
        user.partnerId = target.id;
        target.partnerId = user.id;
        saveDB(db);
        const today = sanitizeToday(url.searchParams.get('today'));
        return json(res, 200, { partner: partnerSummary(db, user, today) });
      }

      if (p === '/api/partner' && req.method === 'GET') {
        const user = authUser(db, req);
        if (!user) return json(res, 401, { error: 'unauthorized' });
        const today = sanitizeToday(url.searchParams.get('today'));
        return json(res, 200, { partner: partnerSummary(db, user, today) });
      }

      /* —— 静态 PWA —— */
      if (req.method === 'GET' && STATIC[p]) {
        const [base, file, type] = STATIC[p];
        const full = path.join(base, file);
        if (fs.existsSync(full)) {
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
          return res.end(fs.readFileSync(full));
        }
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  };
}

module.exports = { merge, createApp, duoStreak };

if (require.main === module) {
  http.createServer(createApp()).listen(PORT, () => {
    console.log(`🎯 Daily Check-in sync server: http://localhost:${PORT}`);
    console.log(`   数据文件: ${DATA_FILE}`);
  });
}
