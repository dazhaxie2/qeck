const { test } = require('node:test');
const assert = require('node:assert');
const { merge, duoStreak } = require('../server.js');

const T1 = [{ id: 1, name: 'A', target: 1, unit: '个', em: '🎯' }];
const T2 = [{ id: 1, name: 'B', target: 2, unit: '个', em: '🔥' }];

function rec(date, tid, value) {
  return { [date]: { tasks: { [tid]: value } } };
}

test('merge:tasks 整表按时间戳取新', () => {
  const r = merge(
    { tasks: T1, records: {}, frozen: [] }, { tasks: 100, cells: {} },
    { tasks: T2, records: {}, frozen: [] }, { tasks: 200, cells: {} },
  );
  assert.equal(r.state.tasks[0].name, 'B');
  assert.equal(r.meta.tasks, 200);
});

test('merge:tasks 服务端较新则保留服务端', () => {
  const r = merge(
    { tasks: T1, records: {}, frozen: [] }, { tasks: 300, cells: {} },
    { tasks: T2, records: {}, frozen: [] }, { tasks: 200, cells: {} },
  );
  assert.equal(r.state.tasks[0].name, 'A');
});

test('merge:records 单元格各取较新', () => {
  const r = merge(
    { tasks: T1, records: { ...rec('2026-06-01', 1, 5) }, frozen: [] },
    { tasks: 1, cells: { '2026-06-01|1': 100, '2026-06-02|1': 100 } },
    { tasks: T1, records: { ...rec('2026-06-02', 1, 3) }, frozen: [] },
    { tasks: 1, cells: { '2026-06-02|1': 200 } },
  );
  assert.equal(r.state.records['2026-06-01'].tasks['1'], 5); // 服务端独有
  assert.equal(r.state.records['2026-06-02'].tasks['1'], 3); // 客户端较新
});

test('merge:较新的 0 值是删除墓碑,不复活旧数据', () => {
  const r = merge(
    { tasks: T1, records: rec('2026-06-01', 1, 5), frozen: [] },
    { tasks: 1, cells: { '2026-06-01|1': 100 } },
    { tasks: T1, records: {}, frozen: [] },
    { tasks: 1, cells: { '2026-06-01|1': 200 } }, // 客户端删了,时间戳更新
  );
  assert.equal(r.state.records['2026-06-01'], undefined);
  assert.equal(r.meta.cells['2026-06-01|1'], 200); // 墓碑时间戳保留
});

test('merge:无 meta 的存量数据不会被空端吞掉', () => {
  const r = merge(
    { tasks: [], records: {}, frozen: [] }, { tasks: 0, cells: {} },
    { tasks: T1, records: rec('2026-06-01', 1, 2), frozen: [] }, { tasks: 0, cells: {} },
  );
  assert.equal(r.state.records['2026-06-01'].tasks['1'], 2);
  assert.equal(r.state.tasks.length, 1);
});

test('merge:frozen 取并集且排序', () => {
  const r = merge(
    { tasks: [], records: {}, frozen: ['2026-06-03', '2026-06-01'] }, { tasks: 0, cells: {} },
    { tasks: [], records: {}, frozen: ['2026-06-02', '2026-06-01'] }, { tasks: 0, cells: {} },
  );
  assert.deepEqual(r.state.frozen, ['2026-06-01', '2026-06-02', '2026-06-03']);
});

test('merge:幂等(同一输入再合并一次结果不变)', () => {
  const s = { tasks: T1, records: rec('2026-06-01', 1, 5), frozen: ['2026-06-02'] };
  const m = { tasks: 50, cells: { '2026-06-01|1': 100 } };
  const r1 = merge(s, m, s, m);
  const r2 = merge(r1.state, r1.meta, r1.state, r1.meta);
  assert.deepEqual(r2.state, r1.state);
  assert.deepEqual(r2.meta, r1.meta);
});

test('duoStreak:两人都打卡的日子才算共同火焰', () => {
  const mk = (dates) => ({
    tasks: [{ id: 1, target: 1 }],
    records: Object.fromEntries(dates.map(d => [d, { tasks: { 1: 1 } }])),
    frozen: new Set(),
  });
  const A = mk(['2026-06-08', '2026-06-09', '2026-06-10']);
  const B = mk(['2026-06-09', '2026-06-10']);
  assert.equal(duoStreak(A, B, '2026-06-10'), 2);
  // B 今天没打,从昨天起算
  const C = mk(['2026-06-08', '2026-06-09']);
  assert.equal(duoStreak(A, C, '2026-06-10'), 2);
  // 完全错开 → 0
  const D = mk(['2026-06-01']);
  assert.equal(duoStreak(A, D, '2026-06-10'), 0);
});
