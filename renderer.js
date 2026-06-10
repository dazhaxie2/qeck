(function () {
  'use strict';

  const Core = window.Core;
  const api = window.api || window.createLocalAdapter();
  const $ = id => document.getElementById(id);
  const DEFAULT_TASKS = [
    { id: 1, name: '深度学习', target: 1, unit: '个', em: '🤖' },
    { id: 2, name: '算法题', target: 2, unit: '题', em: '💻' },
    { id: 3, name: '阅读复盘', target: 5, unit: '页', em: '📚' },
  ];
  const EMOJIS = ['🎯', '📚', '💻', '🏃', '💧', '🧘', '✍️', '🎧', '🌱', '🔥', '⭐', '🏆'];

  const state = {
    tasks: [],
    records: {},
    frozen: new Set(),
    settings: {},
    lang: 'zh',
    today: Core.ds(new Date()),
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    editing: [],
    emojiIndex: -1,
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

  function dict() {
    return Core.I18N[state.lang] || Core.I18N.zh;
  }

  function tx(key, vars = {}) {
    const source = dict()[key] ?? Core.I18N.zh[key] ?? key;
    if (typeof source !== 'string') return source;
    return source.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  }

  function rowsToRecords(rows) {
    const out = {};
    for (const row of rows || []) {
      if (!out[row.date]) out[row.date] = { tasks: {} };
      out[row.date].tasks[row.task_id] = row.value;
    }
    return out;
  }

  function stateForCore() {
    return {
      tasks: state.tasks,
      records: state.records,
      frozen: state.frozen,
    };
  }

  function todayRecord() {
    if (!state.records[state.today]) state.records[state.today] = { tasks: {} };
    return state.records[state.today];
  }

  function freezeLeft() {
    return Math.max(0, Core.freezeCreditsEarned(Core.totalPerfect(stateForCore())) - state.frozen.size);
  }

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function formatDateLine() {
    const locale = tx('dateLocale');
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(state.today + 'T00:00:00'));
  }

  function monthLabel(year, month) {
    const months = dict().months;
    if (months) return `${months[month]} ${year}`;
    return `${year} 年 ${month + 1} 月`;
  }

  function applyStaticText() {
    $('hd-logo').textContent = `🎯 ${tx('appName')}`;
    $('hd-date').textContent = formatDateLine();
    $('btn-lang').textContent = tx('langBtn');
    $('btn-edit').textContent = tx('editTasks');
    $('sec-today').textContent = tx('todayTasks');
    $('sec-cal').textContent = tx('calTitle');
    $('sec-heat').textContent = tx('heatTitle');
    $('btn-share').textContent = tx('shareBtn');
    $('sec-stats').textContent = tx('statsTitle');
    $('sec-badges').textContent = tx('badgesTitle');
    $('sec-data').textContent = tx('dataTitle');
    $('btn-export').textContent = tx('exportBtn');
    $('btn-import').textContent = tx('importBtn');
    $('modal-title').textContent = tx('modalTitle');
    $('msec-list').textContent = tx('listLabel');
    $('btn-add').textContent = tx('addTask');
    $('btn-save').textContent = tx('saveTask');
    $('msec-remind').textContent = tx('remindLabel');
    $('remind-hint').textContent = tx('remindHint');
    $('btn-remind-off').textContent = tx('remindOff');
    $('msec-danger').textContent = tx('danger');
    $('btn-reset').textContent = tx('clearToday');
    $('remind-time').value = state.settings.remindTime || '';
  }

  function renderStreak() {
    const st = stateForCore();
    const streak = Core.calcStreak(st, state.today);
    const best = Core.calcLongest(st);
    const doneToday = Core.isPerfect(st, state.today);
    const hasToday = Core.hasProgress(st, state.today);
    const repairDate = Core.repairableDate(st, state.today);
    const canRepair = repairDate && freezeLeft() > 0;
    const mood = doneToday ? 'ok' : streak > 0 ? 'fire' : hasToday ? 'fresh' : 'zero';
    const chip = doneToday ? ['chip-ok', tx('chipDone')] :
      streak > 0 ? ['chip-go', tx('chipGoing')] :
        hasToday ? ['chip-fresh', tx('chipFresh')] : ['chip-bad', tx('chipBroken')];

    $('streak-card').innerHTML = `
      <div class="streak-card sk-${mood}">
        <div class="sk-left">
          <div class="sk-icon">${doneToday ? '🎉' : streak > 0 ? '🔥' : '🎯'}</div>
          <div>
            <div class="sk-num ${mood}">${streak}</div>
            <div class="sk-unit">${tx('streakUnit')}</div>
            <div class="sk-freeze">${tx('freezeLeft', { n: freezeLeft() })}</div>
          </div>
        </div>
        <div class="sk-right">
          <div class="sk-chip ${chip[0]}">${chip[1]}</div>
          <div class="sk-best">${tx('bestTip', { n: best })}</div>
        </div>
      </div>`;

    const breaks = Core.calcBreaks(st, state.today);
    if ((breaks > 0 || canRepair) && !doneToday) {
      $('punish').style.display = 'flex';
      $('punish').className = 'punish';
      $('punish').innerHTML = `
        <div class="punish-em">⚡</div>
        <div class="punish-t">
          <strong>${tx('punishTitle', { n: breaks })}</strong>
          <span>${canRepair ? tx('repairBtn', { date: repairDate }) : tx('punishBody')}</span>
        </div>
        ${canRepair ? `<button class="repair-btn" onclick="repairYesterday('${repairDate}')">${tx('repairBtn', { date: repairDate })}</button>` : ''}`;
    } else {
      $('punish').style.display = 'none';
    }
  }

  function renderTasks() {
    const rec = todayRecord();
    const done = Core.dayDone(stateForCore(), state.today);
    $('prog-meta').innerHTML = tx('progMeta', { done, total: state.tasks.length });
    if (!state.tasks.length) {
      $('tasks').innerHTML = `<div class="tc"><div class="tc-body"><div class="tc-name">${tx('emptyTasks')}</div></div></div>`;
      return;
    }

    $('tasks').innerHTML = state.tasks.map(task => {
      const value = rec.tasks[task.id] || 0;
      const pct = Math.min(100, Math.round(value / task.target * 100));
      const doneClass = value >= task.target ? 'done' : '';
      const color = value >= task.target ? 'var(--ok)' : pct > 0 ? 'var(--p2)' : 'var(--mu)';
      const r = 25;
      const c = 2 * Math.PI * r;
      return `
        <div class="tc ${doneClass}">
          <div class="ring-wrap">
            <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
              <circle class="rb" cx="29" cy="29" r="${r}"></circle>
              <circle class="rp" cx="29" cy="29" r="${r}" stroke="${color}"
                stroke-dasharray="${c}" stroke-dashoffset="${c - c * pct / 100}"
                transform="rotate(-90 29 29)"></circle>
            </svg>
            <div class="rem">${esc(task.em)}</div>
          </div>
          <div class="tc-body">
            <div class="tc-name">${esc(task.name)}</div>
            <div class="tc-prog" style="color:${color}">${value} / ${task.target} ${esc(task.unit)}</div>
            <div class="tc-bar"><div class="tc-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>
          <div class="tc-ctrl">
            <button class="tc-btn" aria-label="${tx('btnMinus')}" onclick="changeTask(${task.id}, -1)">−</button>
            <div class="tc-val" style="color:${color}">${value}</div>
            <button class="tc-btn" aria-label="${tx('btnPlus')}" onclick="changeTask(${task.id}, 1)">+</button>
          </div>
        </div>`;
    }).join('');
  }

  function renderStatus() {
    const st = stateForCore();
    const done = Core.dayDone(st, state.today);
    const left = Math.max(0, state.tasks.length - done);
    const btn = $('status-btn');
    if (!state.tasks.length) {
      btn.className = 'sb idle';
      btn.textContent = tx('emptyTasks');
    } else if (left === 0) {
      btn.className = 'sb win';
      btn.textContent = tx('statusWin', { s: Core.calcStreak(st, state.today) });
    } else if (done > 0) {
      btn.className = 'sb partial';
      btn.textContent = tx('statusPartial', { n: left });
    } else {
      btn.className = 'sb idle';
      btn.textContent = tx('chipFresh');
    }
  }

  function renderCalendar() {
    const y = state.viewYear;
    const m = state.viewMonth;
    const first = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    const weekdays = dict().weekdays;
    $('cal-mo').textContent = monthLabel(y, m);
    $('cal-next').disabled = `${y}-${Core.pad(m + 1)}` >= state.today.slice(0, 7);
    $('leg-p').textContent = tx('legAll');
    $('leg-pp').textContent = tx('legPart');
    $('leg-m').textContent = tx('legMiss');
    $('leg-f').textContent = tx('legFrozen');
    $('leg-t').textContent = tx('legToday');

    const cells = weekdays.map(day => `<div class="cal-dw">${day}</div>`);
    for (let i = 0; i < first; i++) cells.push('<div></div>');
    for (let day = 1; day <= dim; day++) {
      const d = `${y}-${Core.pad(m + 1)}-${Core.pad(day)}`;
      const isFuture = d > state.today;
      const frozen = state.frozen.has(d);
      const perfect = Core.isPerfect(stateForCore(), d);
      const progress = Core.hasProgress(stateForCore(), d);
      const cls = ['cc'];
      if (d === state.today) cls.push('cc-today');
      if (frozen) cls.push('cc-f');
      else if (perfect) cls.push('cc-p');
      else if (progress) cls.push('cc-pp');
      else if (isFuture) cls.push('cc-fut');
      else cls.push('cc-m');
      cells.push(`<div class="${cls.join(' ')}">${day}</div>`);
    }
    $('cal-grid').innerHTML = cells.join('');
  }

  function renderHeatmap() {
    const cells = [];
    const start = Core.addDays(state.today, -181);
    const offset = new Date(start + 'T00:00:00').getDay();
    for (let i = 0; i < offset; i++) cells.push('<div class="hc hx"></div>');
    for (let i = 0; i < 182; i++) {
      const d = Core.addDays(start, i);
      let cls = 'hc';
      if (state.frozen.has(d)) cls += ' hf';
      else if (Core.isPerfect(stateForCore(), d)) cls += ' h2';
      else if (Core.hasProgress(stateForCore(), d)) cls += ' h1';
      cells.push(`<div class="${cls}" title="${d}"></div>`);
    }
    $('heat').innerHTML = cells.join('');
  }

  function renderStats() {
    const st = stateForCore();
    const stats = [
      [Core.calcStreak(st, state.today), tx('stCur'), 'good'],
      [Core.calcLongest(st), tx('stBest'), 'good'],
      [Core.totalPerfect(st), tx('stTotal'), ''],
      [`${Core.monthRate(st, state.viewYear, state.viewMonth, state.today)}%`, tx('stMonth'), 'warn'],
      [Core.calcBreaks(st, state.today), tx('stBreaks'), 'bad'],
      [state.tasks.length, tx('stTasks'), ''],
    ];
    $('stats').innerHTML = stats.map(item => `
      <div class="stat ${item[2]}">
        <div class="stat-v">${item[0]}</div>
        <div class="stat-l">${item[1]}</div>
      </div>`).join('');
  }

  function renderBadges() {
    const best = Core.calcLongest(stateForCore());
    $('badges').innerHTML = Core.BDEFS.map(badge => {
      const meta = dict().badges[badge.id];
      const unlocked = best >= badge.req;
      return `
        <div class="badge ${unlocked ? 'e' : 'lk'}">
          <div class="bg-em">${badge.em}</div>
          <div class="bg-n">${esc(meta[0])}</div>
          <div class="bg-r">${esc(meta[1])}</div>
        </div>`;
    }).join('');
  }

  function renderAll() {
    applyStaticText();
    renderStreak();
    renderTasks();
    renderStatus();
    renderCalendar();
    renderHeatmap();
    renderStats();
    renderBadges();
    if (window.appSync) window.appSync.render();
  }

  async function loadAll() {
    state.settings = await api.getSettings();
    state.lang = state.settings.lang || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
    state.tasks = await api.getTasks();
    if (!state.tasks.length) {
      state.tasks = DEFAULT_TASKS;
      await api.saveTasks(state.tasks).catch(() => {});
    }
    state.records = rowsToRecords(await api.getRecords());
    state.frozen = new Set(await api.getFrozen());
    state.today = Core.ds(new Date());
    const now = new Date(state.today + 'T00:00:00');
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    renderAll();
    scheduleReminder();
  }

  window.changeTask = async function changeTask(id, delta) {
    const rec = todayRecord();
    const cur = rec.tasks[id] || 0;
    const next = Math.max(0, Math.min(1000000, cur + delta));
    rec.tasks[id] = next;
    await api.setRecord(state.today, id, next);
    if (window.appSync) window.appSync.touchCell(state.today, id);
    if (Core.isPerfect(stateForCore(), state.today) && cur !== next) showToast(tx('allDone'));
    renderAll();
  };

  window.prevMo = function prevMo() {
    if (state.viewMonth === 0) {
      state.viewMonth = 11;
      state.viewYear--;
    } else state.viewMonth--;
    renderAll();
  };

  window.nextMo = function nextMo() {
    if (`${state.viewYear}-${Core.pad(state.viewMonth + 1)}` >= state.today.slice(0, 7)) return;
    if (state.viewMonth === 11) {
      state.viewMonth = 0;
      state.viewYear++;
    } else state.viewMonth++;
    renderAll();
  };

  window.toggleLang = async function toggleLang() {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    state.settings.lang = state.lang;
    await api.setSetting('lang', state.lang).catch(() => {});
    renderAll();
  };

  function nextTaskId() {
    return Math.max(0, ...state.editing.map(t => Number(t.id) || 0), ...state.tasks.map(t => Number(t.id) || 0)) + 1;
  }

  function renderEditor() {
    $('te-list').innerHTML = state.editing.map((task, index) => `
      <div class="te">
        <div class="te-r">
          <button class="em-btn" onclick="openEmojiPicker(${index}, event)">${esc(task.em || '🎯')}</button>
          <div style="flex:1;min-width:0">
            <div class="te-lbl">${tx('lblName')}</div>
            <input class="inp" value="${esc(task.name)}" placeholder="${tx('phName')}" oninput="editTask(${index}, 'name', this.value)">
          </div>
          <button class="del-btn" onclick="removeTE(${index})">${tx('btnDel')}</button>
        </div>
        <div class="te-r">
          <div>
            <div class="te-lbl">${tx('lblTarget')}</div>
            <input class="inp inp-n" type="number" min="1" max="999" value="${task.target}" oninput="editTask(${index}, 'target', this.value)">
          </div>
          <div>
            <div class="te-lbl">${tx('lblUnit')}</div>
            <input class="inp inp-u" value="${esc(task.unit)}" placeholder="${tx('phUnit')}" oninput="editTask(${index}, 'unit', this.value)">
          </div>
        </div>
      </div>`).join('');
  }

  window.openModal = function openModal() {
    state.editing = state.tasks.map(task => ({ ...task }));
    if (!state.editing.length) state.editing = [{ id: 1, name: '', target: 1, unit: tx('phUnit'), em: '🎯' }];
    renderEditor();
    $('ov').classList.add('open');
  };

  window.closeModal = function closeModal() {
    $('ov').classList.remove('open');
    $('ep').classList.remove('open');
  };

  window.ovClick = function ovClick(event) {
    if (event.target.id === 'ov') window.closeModal();
  };

  window.addTE = function addTE() {
    state.editing.push({ id: nextTaskId(), name: '', target: 1, unit: tx('phUnit'), em: '🎯' });
    renderEditor();
  };

  window.removeTE = function removeTE(index) {
    if (state.editing.length <= 1) {
      showToast(tx('minOne'));
      return;
    }
    state.editing.splice(index, 1);
    renderEditor();
  };

  window.editTask = function editTask(index, key, value) {
    state.editing[index][key] = key === 'target' ? Number(value) : value;
  };

  window.openEmojiPicker = function openEmojiPicker(index, event) {
    state.emojiIndex = index;
    const ep = $('ep');
    const rect = event.currentTarget.getBoundingClientRect();
    ep.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
    ep.style.top = `${rect.bottom + 8}px`;
    ep.innerHTML = EMOJIS.map(emoji => `<button class="ep-b" onclick="pickEmoji('${emoji}')">${emoji}</button>`).join('');
    ep.classList.add('open');
  };

  window.pickEmoji = function pickEmoji(emoji) {
    if (state.emojiIndex >= 0) state.editing[state.emojiIndex].em = emoji;
    $('ep').classList.remove('open');
    renderEditor();
  };

  window.saveEdits = async function saveEdits() {
    const cleaned = state.editing.map(task => ({
      id: Number(task.id),
      name: String(task.name || '').trim(),
      target: Number(task.target),
      unit: String(task.unit || tx('phUnit')).trim(),
      em: String(task.em || '🎯'),
    }));
    if (cleaned.some(task => !task.name)) return showToast(tx('needName'));
    if (cleaned.some(task => !Number.isInteger(task.target) || task.target < 1)) return showToast(tx('needTarget'));
    try {
      await api.saveTasks(cleaned);
      state.tasks = cleaned;
      if (window.appSync) window.appSync.touchTasks();
      window.closeModal();
      showToast(tx('saved'));
      renderAll();
    } catch (_) {
      showToast(tx('saveFail'));
    }
  };

  window.confirmReset = async function confirmReset() {
    if (!confirm(tx('confirmClear'))) return;
    delete state.records[state.today];
    await api.deleteDateRecords(state.today);
    if (window.appSync) window.appSync.touchDate(state.today);
    showToast(tx('cleared'));
    renderAll();
  };

  window.repairYesterday = async function repairYesterday(date) {
    if (freezeLeft() <= 0) return;
    await api.addFrozen(date);
    state.frozen.add(date);
    if (window.appSync) window.appSync.schedule();
    showToast(tx('repairDone', { date }));
    renderAll();
  };

  window.setReminder = async function setReminder(value) {
    state.settings.remindTime = value || '';
    await api.setSetting('remindTime', state.settings.remindTime);
    scheduleReminder();
    showToast(value ? tx('remindSet', { t: value }) : tx('remindOffDone'));
  };

  function scheduleReminder() {
    clearInterval(scheduleReminder.timer);
    scheduleReminder.timer = setInterval(checkReminder, 30000);
  }

  async function checkReminder() {
    const time = state.settings.remindTime;
    if (!time || Core.isPerfect(stateForCore(), state.today)) return;
    const now = new Date();
    const hhmm = `${Core.pad(now.getHours())}:${Core.pad(now.getMinutes())}`;
    const key = `reminded:${state.today}:${time}`;
    if (hhmm !== time || state.settings[key]) return;
    state.settings[key] = '1';
    await api.setSetting(key, '1').catch(() => {});
    if ('Notification' in window) {
      if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      if (Notification.permission === 'granted') new Notification(tx('appName'), { body: tx('remindBody') });
    }
    showToast(tx('remindBody'));
  }

  function downloadJson(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.exportData = async function exportData() {
    try {
      const data = await api.exportJSON();
      downloadJson(`daily-checkin-${state.today}.json`, data);
      showToast(tx('exportDone'));
    } catch (_) {
      showToast(tx('exportFail'));
    }
  };

  window.importData = function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.tasks) || !data.tasks.length) return showToast(tx('importBad'));
        if (!confirm(tx('importConfirm', { n: Object.keys(data.records || {}).length }))) return;
        await api.importJSON(data);
        showToast(tx('importDone'));
        await loadAll();
        if (window.appSync) window.appSync.touchAll();
      } catch (err) {
        showToast(tx('importFail', { msg: err.message || err }));
      }
    };
    input.click();
  };

  window.shareCard = function shareCard() {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1080, 1440);
    grad.addColorStop(0, '#16162a');
    grad.addColorStop(1, '#311329');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1440);
    ctx.fillStyle = '#fe2c55';
    ctx.font = 'bold 70px system-ui, sans-serif';
    ctx.fillText(tx('appName'), 90, 160);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 230px system-ui, sans-serif';
    ctx.fillText(String(Core.calcStreak(stateForCore(), state.today)), 90, 460);
    ctx.fillStyle = '#ff8fa3';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillText(tx('cardUnit'), 95, 545);
    ctx.fillStyle = '#f0f0f5';
    ctx.font = '42px system-ui, sans-serif';
    ctx.fillText(tx('cardTotal', {
      n: Core.totalPerfect(stateForCore()),
      m: Core.calcLongest(stateForCore()),
    }), 90, 670);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(90, 760, 900, 2);
    ctx.fillStyle = '#f0f0f5';
    ctx.font = '36px system-ui, sans-serif';
    state.tasks.slice(0, 6).forEach((task, index) => {
      const value = todayRecord().tasks[task.id] || 0;
      ctx.fillText(`${task.em} ${task.name}  ${value}/${task.target}${task.unit}`, 100, 850 + index * 70);
    });
    ctx.fillStyle = '#8a8ab0';
    ctx.font = '32px system-ui, sans-serif';
    ctx.fillText(tx('cardFooter'), 90, 1320);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `daily-checkin-card-${state.today}.png`;
    a.click();
    showToast(tx('shareDone'));
  };

  setInterval(() => {
    const nextToday = Core.ds(new Date());
    if (nextToday !== state.today) loadAll().then(() => showToast(tx('newDay')));
  }, 60000);

  // 供 sync.js 等扩展模块使用的桥
  window.app = { state, loadAll, renderAll, showToast, tx };

  loadAll().catch(err => {
    console.error(err);
    showToast(tx('loadFail', { msg: err.message || err }));
  });

  if (!window.api && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
