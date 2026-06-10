/* ══════════════════════════════════════════════════════════════
   core.js — 核心领域逻辑(纯函数,无 DOM / Electron 依赖)
   浏览器经 <script> 挂到 window.Core,Node 经 module.exports 供测试复用
   state 约定:{ tasks:[{id,name,target,unit,em}], records:{date:{tasks:{id:value}}}, frozen:Set<date> }
   ══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── 日期工具 ── */
  const pad = n => String(n).padStart(2, '0');
  const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return ds(d);
  }

  /* ── 成就定义(名称/描述在 I18N 里按语言取) ── */
  const BDEFS = [
    { id: 'b3',   em: '🌱', req: 3 },
    { id: 'b7',   em: '🔥', req: 7 },
    { id: 'b14',  em: '⭐', req: 14 },
    { id: 'b30',  em: '🏆', req: 30 },
    { id: 'b60',  em: '💎', req: 60 },
    { id: 'b100', em: '👑', req: 100 },
  ];

  /* ── 修复券经济:每累计 7 个完美打卡日获得 1 张 ── */
  const FREEZE_EARN_EVERY = 7;
  const freezeCreditsEarned = totalPerfect => Math.floor(totalPerfect / FREEZE_EARN_EVERY);

  /* ── 单日判定 ── */
  function isPerfect(st, d) {
    const r = st.records[d];
    if (!r || !r.tasks || !st.tasks.length) return false;
    return st.tasks.every(t => (r.tasks[t.id] || 0) >= t.target);
  }
  function hasProgress(st, d) {
    const r = st.records[d];
    if (!r || !r.tasks) return false;
    return Object.values(r.tasks).some(v => v > 0);
  }
  function dayDone(st, d) {
    const r = st.records[d];
    if (!r || !r.tasks) return 0;
    return st.tasks.filter(t => (r.tasks[t.id] || 0) >= t.target).length;
  }
  /* 链条日 = 完美打卡 或 被修复券补回 */
  function isChainDay(st, d) {
    return isPerfect(st, d) || (st.frozen && st.frozen.has(d));
  }

  /* ── 连续天数:从今天往回数;今天没完成则从昨天起算(不含今天) ── */
  function calcStreak(st, today) {
    let s = 0, cur = today;
    while (isChainDay(st, cur)) {
      s++;
      cur = addDays(cur, -1);
      if (s > 3650) break;
    }
    if (s === 0) {
      cur = addDays(today, -1);
      while (isChainDay(st, cur)) {
        s++;
        cur = addDays(cur, -1);
        if (s > 3650) break;
      }
    }
    return s;
  }

  /* ── 历史最长:对记录日期 ∪ 修复日期排序,数连续链条段 ── */
  function chainDates(st) {
    const set = new Set(Object.keys(st.records));
    if (st.frozen) for (const d of st.frozen) set.add(d);
    return [...set].sort();
  }
  function calcLongest(st) {
    const dates = chainDates(st);
    let cur = 0, max = 0, prev = null;
    for (const d of dates) {
      if (isChainDay(st, d)) {
        cur = (prev !== null && addDays(prev, 1) === d) ? cur + 1 : 1;
        max = Math.max(max, cur);
        prev = d;
      } else {
        cur = 0;
        prev = null;
      }
    }
    return max;
  }

  /* ── 历史中断次数(今天之前,链条日 → 非链条日的转折) ── */
  function calcBreaks(st, today) {
    const dates = chainDates(st).filter(d => d < today);
    let breaks = 0, prevChain = false;
    for (const d of dates) {
      const c = isChainDay(st, d);
      if (!c && prevChain) breaks++;
      prevChain = c;
    }
    return breaks;
  }

  function totalPerfect(st) {
    return Object.keys(st.records).filter(d => isPerfect(st, d)).length;
  }

  /* ── 月完成率(today 为 'YYYY-MM-DD' 边界,只统计已过去的天) ── */
  function monthRate(st, y, m, today) {
    const ty = +today.slice(0, 4), tm = +today.slice(5, 7) - 1, td = +today.slice(8, 10);
    const dim = new Date(y, m + 1, 0).getDate();
    let end;
    if (y === ty && m === tm) end = td;
    else if (y < ty || (y === ty && m < tm)) end = dim;
    else end = 0;
    let perf = 0;
    for (let d = 1; d <= end; d++) {
      if (isPerfect(st, `${y}-${pad(m + 1)}-${pad(d)}`)) perf++;
    }
    return end > 0 ? Math.round(perf / end * 100) : 0;
  }

  /* ── 可修复判定:昨天断了 & 前天还在链上 → 补回昨天即可重连 ── */
  function repairableDate(st, today) {
    const y = addDays(today, -1);
    if (isChainDay(st, y)) return null;
    if (!isChainDay(st, addDays(y, -1))) return null;
    return y;
  }

  /* ══════════════ I18N ══════════════ */
  const I18N = {
    zh: {
      appName: '每日打卡',
      editTasks: '⚙️ 编辑任务',
      todayTasks: '今日任务',
      progMeta: '<b>{done}</b> / {total} 项完成',
      ovToday: '今日进度',
      ovMonth: '本月完成',
      ovRepair: '修复券',
      emptyTasks: '暂无任务，点击"编辑任务"添加',
      chipFresh: '开始打卡之旅',
      chipBroken: '记录已中断',
      chipDone: '✅ 今日已完成！',
      chipGoing: '⚡ 今日进行中',
      streakUnit: '天连续打卡',
      bestTip: '历史最高：{n}天',
      refreshing: '🏅 正在刷新历史记录！',
      freezeLeft: '🧊 修复券 ×{n}',
      punishTitle: '连续记录已中断，已中断 {n} 次',
      punishBody: '今天是重新开始的机会，坚持下去！',
      repairBtn: '🧊 用修复券补回 {date}',
      repairDone: '🧊 已补回 {date}，连续记录恢复！',
      statusWin: '🎉 今日所有任务完成！连续打卡第 {s} 天',
      statusPartial: '⏳ 还有 {n} 项任务未完成，加油！',
      calTitle: '本月打卡日历',
      weekdays: ['日', '一', '二', '三', '四', '五', '六'],
      legAll: '全部完成', legPart: '部分完成', legMiss: '未打卡', legToday: '今天', legFrozen: '已修复',
      heatTitle: '打卡热力图',
      shareBtn: '📤 分享卡片',
      shareDone: '📤 分享卡片已保存，发出去吧！',
      statsTitle: '统计数据',
      stCur: '当前连续<br>打卡天数', stBest: '历史最长<br>连续记录', stTotal: '累计完美<br>打卡天数',
      stMonth: '本月完成<br>率', stBreaks: '历史连续<br>中断次数', stTasks: '当前任务<br>数量',
      badgesTitle: '成就徽章',
      badges: {
        b3: ['破冰者', '连续3天'], b7: ['七日勇者', '连续7天'], b14: ['两周达人', '连续14天'],
        b30: ['月度精英', '连续30天'], b60: ['钻石意志', '连续60天'], b100: ['百日大师', '连续100天'],
      },
      badgeUnlock: '🏅 新成就解锁：{em} {name}！',
      dataTitle: '💾 数据管理',
      exportBtn: '📤 导出 JSON', importBtn: '📥 导入 JSON',
      exportDone: '📤 数据已导出为 JSON 文件', exportFail: '⚠️ 导出失败，请重试',
      importBad: '⚠️ 文件格式不正确',
      importConfirm: '导入数据将覆盖当前所有记录（含 {n} 天打卡记录），确认？',
      importDone: '📥 数据导入成功！',
      importFail: '⚠️ 文件解析失败：{msg}',
      modalTitle: '✏️ 编辑任务', listLabel: '任务列表',
      lblEmoji: 'emoji', lblName: '任务名称', lblTarget: '每日目标', lblUnit: '单位',
      phName: '任务名称', phUnit: '个/篇', btnDel: '删除',
      addTask: '＋ 添加新任务', saveTask: '💾 保存任务',
      remindLabel: '⏰ 每日提醒',
      remindHint: '当天还没全部完成时，到点提醒',
      remindSet: '⏰ 已设置每日提醒 {t}', remindOffDone: '⏰ 提醒已关闭', remindOff: '关闭',
      remindBody: '今天的打卡还没完成，加油！',
      danger: '危险操作', clearToday: '🗑️ 清空今日进度',
      confirmClear: '确认清空今日所有进度？此操作不可撤销。',
      cleared: '🗑️ 今日进度已清空',
      minOne: '⚠️ 至少需要保留一个任务',
      needName: '⚠️ 任务名称不能为空', needTarget: '⚠️ 目标数量至少为1',
      saved: '✅ 任务已保存！', saveFail: '⚠️ 保存失败，请重试', opFail: '⚠️ 操作失败，请重试',
      allDone: '🎉 太棒了！今日任务全部完成！',
      newDay: '🌅 新的一天开始了，加油打卡！',
      loadFail: '⚠️ 数据加载失败：{msg}',
      cardTotal: '累计 {n} 个完美打卡日 · 最长连续 {m} 天',
      cardUnit: '天连续打卡',
      cardFooter: '每日打卡 Daily Check-in',
      buddyTitle: '👥 打卡搭子',
      buddyPitch: '绑定一位搭子，互相监督：一人断签，两人的共同火焰一起熄灭！',
      buddyNeedSync: '先在下方「数据管理」连接云同步，即可解锁搭子功能',
      buddyCodeLbl: '我的邀请码（发给搭子）',
      buddyEnterPh: '输入搭子的邀请码',
      buddyPairBtn: '🤝 绑定搭子',
      buddyTodayDone: '✅ 今日已完成',
      buddyTodayNot: '⏳ 今日未完成',
      buddyStreakLbl: '连续打卡',
      buddyDays: '{n} 天',
      buddyFlame: '🔥 共同火焰 {n} 天',
      buddyFlameOut: '💔 共同火焰已熄灭，今天一起重新点燃！',
      pairDone: '🤝 搭子绑定成功！',
      pairFail: '⚠️ 绑定失败：{msg}',
      syncUrlPh: '服务器地址，如 http://localhost:8787',
      syncNamePh: '你的昵称',
      syncConnect: '☁️ 连接云同步',
      syncConnected: '☁️ 已连接：{name}',
      syncNowBtn: '🔄 立即同步',
      syncLast: '上次同步 {t}',
      syncNever: '尚未同步',
      syncDone: '☁️ 同步完成',
      syncFail: '⚠️ 同步失败：{msg}',
      syncOff: '断开',
      syncOffDone: '已断开云同步（本地数据保留）',
      syncNeedUrl: '⚠️ 请填写 http(s) 服务器地址',
      dateLocale: 'zh-CN',
      langBtn: 'EN',
      btnMinus: '减少', btnPlus: '增加',
    },
    en: {
      appName: 'Daily Check-in',
      editTasks: '⚙️ Edit Tasks',
      todayTasks: "Today's Tasks",
      progMeta: '<b>{done}</b> / {total} done',
      ovToday: 'Today',
      ovMonth: 'This month',
      ovRepair: 'Repairs',
      emptyTasks: 'No tasks yet — tap "Edit Tasks" to add one',
      chipFresh: 'Start your journey',
      chipBroken: 'Streak broken',
      chipDone: '✅ Done for today!',
      chipGoing: '⚡ In progress',
      streakUnit: 'day streak',
      bestTip: 'Best: {n} days',
      refreshing: '🏅 New personal record!',
      freezeLeft: '🧊 Repairs ×{n}',
      punishTitle: 'Streak broken — {n} break(s) so far',
      punishBody: 'Today is your chance to restart. Keep going!',
      repairBtn: '🧊 Repair {date} with a token',
      repairDone: '🧊 {date} repaired — streak restored!',
      statusWin: '🎉 All tasks done! Day {s} of your streak',
      statusPartial: '⏳ {n} task(s) left — keep going!',
      calTitle: 'This Month',
      weekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      legAll: 'Perfect', legPart: 'Partial', legMiss: 'Missed', legToday: 'Today', legFrozen: 'Repaired',
      heatTitle: 'Activity Heatmap',
      shareBtn: '📤 Share Card',
      shareDone: '📤 Card saved — go share it!',
      statsTitle: 'Statistics',
      stCur: 'Current<br>streak', stBest: 'Longest<br>streak', stTotal: 'Perfect<br>days',
      stMonth: 'Month<br>rate', stBreaks: 'Streak<br>breaks', stTasks: 'Active<br>tasks',
      badgesTitle: 'Achievements',
      badges: {
        b3: ['Icebreaker', '3-day streak'], b7: ['Week Warrior', '7-day streak'], b14: ['Fortnight Pro', '14-day streak'],
        b30: ['Monthly Elite', '30-day streak'], b60: ['Diamond Will', '60-day streak'], b100: ['Centurion', '100-day streak'],
      },
      badgeUnlock: '🏅 Achievement unlocked: {em} {name}!',
      dataTitle: '💾 Data',
      exportBtn: '📤 Export JSON', importBtn: '📥 Import JSON',
      exportDone: '📤 Data exported as JSON', exportFail: '⚠️ Export failed, try again',
      importBad: '⚠️ Invalid file format',
      importConfirm: 'Importing will overwrite all current data ({n} days of records). Continue?',
      importDone: '📥 Import successful!',
      importFail: '⚠️ Failed to parse file: {msg}',
      modalTitle: '✏️ Edit Tasks', listLabel: 'Task list',
      lblEmoji: 'emoji', lblName: 'Task name', lblTarget: 'Daily goal', lblUnit: 'Unit',
      phName: 'Task name', phUnit: 'times', btnDel: 'Delete',
      addTask: '＋ Add task', saveTask: '💾 Save tasks',
      remindLabel: '⏰ Daily reminder',
      remindHint: 'Remind me at this time if today is not done',
      remindSet: '⏰ Daily reminder set for {t}', remindOffDone: '⏰ Reminder turned off', remindOff: 'Off',
      remindBody: "You haven't finished today's check-in yet — go for it!",
      danger: 'Danger zone', clearToday: "🗑️ Clear today's progress",
      confirmClear: "Clear all of today's progress? This cannot be undone.",
      cleared: "🗑️ Today's progress cleared",
      minOne: '⚠️ Keep at least one task',
      needName: '⚠️ Task name cannot be empty', needTarget: '⚠️ Goal must be at least 1',
      saved: '✅ Tasks saved!', saveFail: '⚠️ Save failed, try again', opFail: '⚠️ Operation failed, try again',
      allDone: '🎉 Awesome! All tasks done today!',
      newDay: '🌅 A new day begins — go check in!',
      loadFail: '⚠️ Failed to load data: {msg}',
      cardTotal: '{n} perfect days · longest {m}-day run',
      cardUnit: 'day streak',
      cardFooter: 'Daily Check-in',
      buddyTitle: '👥 Accountability Buddy',
      buddyPitch: 'Pair up with a buddy. If either of you misses a day, your shared flame goes out — together!',
      buddyNeedSync: 'Connect cloud sync in "Data" below to unlock the buddy feature',
      buddyCodeLbl: 'My invite code (send it to your buddy)',
      buddyEnterPh: "Enter your buddy's code",
      buddyPairBtn: '🤝 Pair up',
      buddyTodayDone: '✅ Done today',
      buddyTodayNot: '⏳ Not done yet',
      buddyStreakLbl: 'Streak',
      buddyDays: '{n} days',
      buddyFlame: '🔥 Shared flame: {n} days',
      buddyFlameOut: '💔 The shared flame is out — relight it together today!',
      pairDone: '🤝 Buddy paired!',
      pairFail: '⚠️ Pairing failed: {msg}',
      syncUrlPh: 'Server URL, e.g. http://localhost:8787',
      syncNamePh: 'Your nickname',
      syncConnect: '☁️ Connect cloud sync',
      syncConnected: '☁️ Connected: {name}',
      syncNowBtn: '🔄 Sync now',
      syncLast: 'Last sync {t}',
      syncNever: 'Never synced',
      syncDone: '☁️ Synced',
      syncFail: '⚠️ Sync failed: {msg}',
      syncOff: 'Disconnect',
      syncOffDone: 'Cloud sync disconnected (local data kept)',
      syncNeedUrl: '⚠️ Enter an http(s) server URL',
      dateLocale: 'en-US',
      langBtn: '中文',
      btnMinus: 'Decrease', btnPlus: 'Increase',
    },
  };

  return {
    pad, ds, addDays,
    BDEFS, I18N,
    FREEZE_EARN_EVERY, freezeCreditsEarned,
    isPerfect, hasProgress, dayDone, isChainDay,
    calcStreak, calcLongest, calcBreaks, totalPerfect, monthRate,
    repairableDate,
  };
});
