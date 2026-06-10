const { test } = require('node:test');
const assert = require('node:assert');
const Core = require('../core.js');

/* 造一个单任务(target=1)的状态:perfect 数组里的日期记为完成 */
function mk(perfect, frozen = [], partial = []) {
  const records = {};
  for (const d of perfect) records[d] = { tasks: { 1: 1 } };
  for (const d of partial) records[d] = { tasks: { 1: 0 } };
  return {
    tasks: [{ id: 1, name: 't', target: 1, unit: '个', em: '🎯' }],
    records,
    frozen: new Set(frozen),
  };
}

const TD = '2026-06-10';

test('日期工具:addDays 跨月', () => {
  assert.equal(Core.addDays('2026-05-31', 1), '2026-06-01');
  assert.equal(Core.addDays('2026-06-01', -1), '2026-05-31');
});

test('calcStreak:从今天往回数', () => {
  const st = mk(['2026-06-08', '2026-06-09', '2026-06-10']);
  assert.equal(Core.calcStreak(st, TD), 3);
});

test('calcStreak:今天未完成则从昨天起算', () => {
  const st = mk(['2026-06-08', '2026-06-09']);
  assert.equal(Core.calcStreak(st, TD), 2);
});

test('calcStreak:修复券补回的日子能续上链条', () => {
  const st = mk(['2026-06-08', '2026-06-10'], ['2026-06-09']);
  assert.equal(Core.calcStreak(st, TD), 3);
});

test('calcStreak:断两天则只剩今天', () => {
  const st = mk(['2026-06-06', '2026-06-07', '2026-06-10']);
  assert.equal(Core.calcStreak(st, TD), 1);
});

test('calcLongest:跨修复日合并成一段', () => {
  const st = mk(['2026-06-01', '2026-06-03', '2026-06-04'], ['2026-06-02']);
  assert.equal(Core.calcLongest(st), 4);
});

test('calcLongest:中间真断开则取最大段', () => {
  const st = mk(['2026-06-01', '2026-06-02', '2026-06-05', '2026-06-06', '2026-06-07']);
  assert.equal(Core.calcLongest(st), 3);
});

test('calcBreaks:修复过的日子不算中断', () => {
  // 6-02 被修复 → 无中断;6-04 留空记录 → 一次中断
  const st = mk(['2026-06-01', '2026-06-03', '2026-06-05'], ['2026-06-02'], ['2026-06-04']);
  assert.equal(Core.calcBreaks(st, TD), 1);
});

test('totalPerfect:只数真实完美日,不含修复日', () => {
  const st = mk(['2026-06-08', '2026-06-10'], ['2026-06-09']);
  assert.equal(Core.totalPerfect(st), 2);
});

test('monthRate:只统计已过去的天', () => {
  // 6 月到今天共 10 天,完成 5 天 → 50%
  const st = mk(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']);
  assert.equal(Core.monthRate(st, 2026, 5, TD), 50);
});

test('repairableDate:昨天断了且前天在链上 → 可修昨天', () => {
  const st = mk(['2026-06-08']);
  assert.equal(Core.repairableDate(st, TD), '2026-06-09');
});

test('repairableDate:断了两天 → 不可修', () => {
  const st = mk(['2026-06-07']);
  assert.equal(Core.repairableDate(st, TD), null);
});

test('repairableDate:昨天本来就在链上 → 无需修', () => {
  const st = mk(['2026-06-09']);
  assert.equal(Core.repairableDate(st, TD), null);
});

test('修复券经济:每 7 个完美日得 1 张', () => {
  assert.equal(Core.freezeCreditsEarned(0), 0);
  assert.equal(Core.freezeCreditsEarned(6), 0);
  assert.equal(Core.freezeCreditsEarned(7), 1);
  assert.equal(Core.freezeCreditsEarned(20), 2);
});

test('I18N:中英文键集合一致', () => {
  const zh = Object.keys(Core.I18N.zh).filter(k => k !== 'months').sort();
  const en = Object.keys(Core.I18N.en).filter(k => k !== 'months').sort();
  assert.deepEqual(zh, en);
  assert.deepEqual(Object.keys(Core.I18N.zh.badges).sort(), Core.BDEFS.map(b => b.id).sort());
});
