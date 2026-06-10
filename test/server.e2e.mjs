/* 服务器 API 全流程 E2E:注册 → 同步 → 配对 → 搭子摘要 → 双端合并 */
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const dataFile = join(mkdtempSync(join(tmpdir(), 'dc-e2e-')), 'data.json');

const srv = spawn(process.execPath, [join(ROOT, 'src', 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SYNC_DATA: dataFile },
  stdio: 'pipe',
});

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/partner'); return; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}
const post = (path, body, token) => fetch(BASE + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));

const TD = '2026-06-10';
const TASKS = [{ id: 1, name: '算法题', target: 1, unit: '题', em: '💻' }];
const recordsOf = dates => Object.fromEntries(dates.map(d => [d, { tasks: { 1: 1 } }]));
const cellsOf = (dates, ts) => Object.fromEntries(dates.map(d => [`${d}|1`, ts]));

try {
  await waitUp();

  // 注册两个用户
  const a = (await post('/api/register', { name: 'Alice' })).body;
  const b = (await post('/api/register', { name: 'Bob' })).body;
  assert.ok(a.token && a.code && b.token && b.code, 'register 返回 token+code');

  // 未授权拒绝
  assert.equal((await post('/api/sync', {}, 'f'.repeat(32))).status, 401);

  // Alice 推送 3 天完美记录
  const aDates = ['2026-06-08', '2026-06-09', TD];
  let r = await post('/api/sync', {
    today: TD,
    state: { tasks: TASKS, records: recordsOf(aDates), frozen: [] },
    meta: { tasks: 1000, cells: cellsOf(aDates, 1000) },
  }, a.token);
  assert.equal(r.status, 200);
  assert.equal(Object.keys(r.body.state.records).length, 3);
  assert.equal(r.body.partner, null, '未配对时 partner 为空');

  // Bob 推送 2 天(昨天+今天)
  r = await post('/api/sync', {
    today: TD,
    state: { tasks: TASKS, records: recordsOf(['2026-06-09', TD]), frozen: [] },
    meta: { tasks: 1000, cells: cellsOf(['2026-06-09', TD], 1000) },
  }, b.token);
  assert.equal(r.status, 200);

  // 配对:Bob 输入 Alice 的邀请码
  r = await post('/api/pair', { code: a.code.toLowerCase() }, b.token); // 大小写不敏感
  assert.equal(r.status, 200);
  assert.equal(r.body.partner.name, 'Alice');
  assert.equal(r.body.partner.streak, 3);
  assert.equal(r.body.partner.todayPerfect, true);
  assert.equal(r.body.partner.duo, 2, '共同火焰 = 两人都完成的连续天数');

  // 自配对、重复配对被拒
  assert.equal((await post('/api/pair', { code: b.code }, b.token)).status, 400);
  const c = (await post('/api/register', { name: 'Carol' })).body;
  assert.equal((await post('/api/pair', { code: a.code }, c.token)).status, 409);

  // Alice 再同步:能看到 Bob,duo 一致
  r = await post('/api/sync', { today: TD, state: { tasks: [], records: {}, frozen: [] }, meta: { tasks: 0, cells: {} } }, a.token);
  assert.equal(r.body.partner.name, 'Bob');
  assert.equal(r.body.partner.duo, 2);
  // 空端拉取不吞掉服务端数据(无 meta 合并保护)
  assert.equal(Object.keys(r.body.state.records).length, 3, 'Alice 数据未被空 payload 吞掉');
  assert.equal(r.body.state.tasks.length, 1);

  // 双端冲突:Alice 设备 2 用更新的时间戳改了今天的值
  r = await post('/api/sync', {
    today: TD,
    state: { tasks: TASKS, records: { [TD]: { tasks: { 1: 5 } } }, frozen: ['2026-06-07'] },
    meta: { tasks: 999, cells: { [`${TD}|1`]: 2000 } },
  }, a.token);
  assert.equal(r.body.state.records[TD].tasks['1'], 5, '较新单元格获胜');
  assert.equal(r.body.state.records['2026-06-08'].tasks['1'], 1, '旧单元格保留');
  assert.deepEqual(r.body.state.frozen, ['2026-06-07'], 'frozen 并集');
  assert.equal(r.body.state.tasks[0].name, '算法题', 'tasks 服务端较新则保留');

  // 静态托管
  const page = await fetch(BASE + '/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('renderer.js'), '首页返回应用');
  assert.equal((await fetch(BASE + '/core.js')).status, 200);
  assert.equal((await fetch(BASE + '/shared/core.js')).status, 200);
  assert.equal((await fetch(BASE + '/server-data.json')).status, 404, '数据文件不可被静态读取');

  console.log('SERVER E2E: ALL PASS ✅');
} finally {
  srv.kill();
}
