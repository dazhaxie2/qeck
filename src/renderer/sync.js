/* ══════════════════════════════════════════════════════════════
   sync.js — 客户端云同步引擎 + 打卡搭子 UI
   依赖:src/shared/core.js(I18N)、renderer.js 暴露的 window.app 桥
   存储经与 renderer 相同的 api(Electron IPC 或 localStorage 适配器)。
   设备本地设置键:sync_url / sync_token / sync_code / sync_name /
                  sync_meta(变更时间戳) / sync_last
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const api = window.api || window.createLocalAdapter();
  const $ = id => document.getElementById(id);

  const S = {
    meta: { tasks: 0, cells: {} },
    partner: null,
    busy: false,
    timer: null,
    lastError: '',
  };

  function appState() { return window.app ? window.app.state : { settings: {}, lang: 'zh' }; }
  function settings() { return appState().settings || {}; }
  function tx(key, vars) { return window.app ? window.app.tx(key, vars) : key; }
  function toast(msg) { if (window.app) window.app.showToast(msg); }
  function configured() { return !!(settings().sync_url && settings().sync_token); }

  function loadMeta() {
    try {
      const raw = settings().sync_meta;
      if (raw) S.meta = JSON.parse(raw);
    } catch (_) { /* 损坏则重置 */ }
    if (!S.meta || typeof S.meta !== 'object') S.meta = { tasks: 0, cells: {} };
    if (!S.meta.cells) S.meta.cells = {};
  }
  async function saveMeta() {
    settings().sync_meta = JSON.stringify(S.meta);
    await api.setSetting('sync_meta', settings().sync_meta).catch(() => {});
  }
  async function setCfg(key, value) {
    settings()[key] = value;
    await api.setSetting(key, value).catch(() => {});
  }

  /* ── 变更打点(renderer 在每次本地修改后调用) ── */
  window.appSync = {
    async touchCell(date, taskId) {
      S.meta.cells[`${date}|${taskId}`] = Date.now();
      await saveMeta();
      this.schedule();
    },
    async touchDate(date) {
      const now = Date.now();
      for (const t of appState().tasks || []) S.meta.cells[`${date}|${t.id}`] = now;
      await saveMeta();
      this.schedule();
    },
    async touchTasks() {
      S.meta.tasks = Date.now();
      await saveMeta();
      this.schedule();
    },
    async touchAll() {
      const now = Date.now();
      S.meta.tasks = now;
      const records = rowsToRecords(await api.getRecords());
      for (const [date, rec] of Object.entries(records)) {
        for (const tid of Object.keys(rec.tasks || {})) S.meta.cells[`${date}|${tid}`] = now;
      }
      await saveMeta();
      this.schedule();
    },
    schedule() {
      if (!configured()) return;
      clearTimeout(S.timer);
      S.timer = setTimeout(() => syncNow(false), 2500);
    },
    render: renderSyncUI,
    syncNow: () => syncNow(true),
  };

  function rowsToRecords(rows) {
    const out = {};
    for (const row of rows || []) {
      if (!out[row.date]) out[row.date] = { tasks: {} };
      out[row.date].tasks[row.task_id] = row.value;
    }
    return out;
  }

  /* 规范化序列化(键排序),用于判断合并结果是否真的变了 */
  function canon(value) {
    if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canon(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  async function request(path, opts = {}) {
    const url = settings().sync_url.replace(/\/+$/, '') + path;
    const res = await fetch(url, {
      method: opts.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings().sync_token ? { Authorization: `Bearer ${settings().sync_token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  /* ── 同步主流程 ── */
  async function syncNow(manual) {
    if (!configured() || S.busy) return;
    S.busy = true;
    try {
      const today = window.Core.ds(new Date());
      const tasks = await api.getTasks();
      const records = rowsToRecords(await api.getRecords());
      const frozen = await api.getFrozen();

      const resp = await request('/api/sync', {
        body: { today, state: { tasks, records, frozen }, meta: S.meta },
      });

      // 合并结果与本地不同才回写(避免无谓的全量重写与闪烁)
      const localCanon = canon({ t: tasks, r: records, f: [...frozen].sort() });
      const remoteCanon = canon({ t: resp.state.tasks, r: resp.state.records, f: resp.state.frozen });
      if (localCanon !== remoteCanon && resp.state.tasks.length) {
        await api.importJSON({
          tasks: resp.state.tasks,
          records: resp.state.records,
          frozen: resp.state.frozen,
          settings: {},
        });
        if (window.app) await window.app.loadAll();
      }

      S.meta = resp.meta;
      await saveMeta();
      S.partner = resp.partner;
      S.lastError = '';
      await setCfg('sync_last', String(Date.now()));
      if (manual) toast(tx('syncDone'));
    } catch (e) {
      S.lastError = e.message || String(e);
      if (manual) toast(tx('syncFail', { msg: S.lastError }));
    } finally {
      S.busy = false;
      renderSyncUI();
    }
  }

  /* ── 连接 / 断开 / 配对 ── */
  window.syncConnect = async function syncConnect() {
    const url = ($('sync-url').value || '').trim().replace(/\/+$/, '');
    const name = ($('sync-name').value || '').trim();
    if (!/^https?:\/\//.test(url)) { toast(tx('syncNeedUrl')); return; }
    try {
      const res = await fetch(url + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await setCfg('sync_url', url);
      await setCfg('sync_token', body.token);
      await setCfg('sync_code', body.code);
      await setCfg('sync_name', body.name);
      await window.appSync.touchAll(); // 存量数据全部打点,首次同步全量上传
      await syncNow(true);
    } catch (e) {
      toast(tx('syncFail', { msg: e.message || e }));
    }
    renderSyncUI();
  };

  window.syncDisconnect = async function syncDisconnect() {
    for (const k of ['sync_url', 'sync_token', 'sync_code', 'sync_name', 'sync_last']) await setCfg(k, '');
    S.partner = null;
    toast(tx('syncOffDone'));
    renderSyncUI();
  };

  window.syncNowClick = function syncNowClick() { syncNow(true); };

  window.buddyPair = async function buddyPair() {
    const code = ($('buddy-code-inp').value || '').trim();
    if (!code) return;
    try {
      const resp = await request('/api/pair', { body: { code } });
      S.partner = resp.partner;
      toast(tx('pairDone'));
    } catch (e) {
      toast(tx('pairFail', { msg: e.message || e }));
    }
    renderSyncUI();
  };

  /* ── UI ── */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

  function renderSyncUI() {
    renderSyncRow();
    renderBuddy();
  }

  function renderSyncRow() {
    const el = $('sync-body');
    if (!el) return;
    if (!configured()) {
      el.innerHTML = `
        <div class="sync-row">
          <input class="inp" id="sync-url" style="flex:2;min-width:180px" placeholder="${tx('syncUrlPh')}">
          <input class="inp" id="sync-name" style="flex:1;min-width:100px" placeholder="${tx('syncNamePh')}">
        </div>
        <div class="sync-row">
          <button class="save-btn" style="padding:11px" onclick="syncConnect()">${tx('syncConnect')}</button>
        </div>`;
      return;
    }
    const last = Number(settings().sync_last || 0);
    const lastTxt = last ? tx('syncLast', { t: new Date(last).toLocaleTimeString(tx('dateLocale')) }) : tx('syncNever');
    el.innerHTML = `
      <div class="sync-row" style="align-items:center">
        <span style="font-size:13px;font-weight:600;color:var(--ok)">${tx('syncConnected', { name: esc(settings().sync_name || '') })}</span>
        <button class="cal-nav" onclick="syncNowClick()">${tx('syncNowBtn')}</button>
        <button class="del-btn" onclick="syncDisconnect()">${tx('syncOff')}</button>
      </div>
      <div class="sync-meta">${lastTxt}${S.lastError ? ' · <span style="color:var(--err)">' + esc(S.lastError) + '</span>' : ''}</div>`;
  }

  function renderBuddy() {
    const el = $('buddy-body');
    if (!el) return;
    const title = $('sec-buddy');
    if (title) title.textContent = tx('buddyTitle');

    if (!configured()) {
      el.innerHTML = `
        <div style="font-size:13px;color:var(--mu);line-height:1.7">${tx('buddyPitch')}</div>
        <div class="sync-meta">${tx('buddyNeedSync')}</div>`;
      return;
    }
    if (!S.partner) {
      el.innerHTML = `
        <div style="font-size:13px;color:var(--mu);line-height:1.7;margin-bottom:10px">${tx('buddyPitch')}</div>
        <div class="te-lbl">${tx('buddyCodeLbl')}</div>
        <div class="buddy-code">${esc(settings().sync_code || '------')}</div>
        <div class="sync-row">
          <input class="inp" id="buddy-code-inp" style="flex:1;text-transform:uppercase" maxlength="6" placeholder="${tx('buddyEnterPh')}">
          <button class="save-btn" style="width:auto;padding:11px 18px" onclick="buddyPair()">${tx('buddyPairBtn')}</button>
        </div>`;
      return;
    }
    const p = S.partner;
    const flame = p.duo > 0
      ? `<div class="flame on">${tx('buddyFlame', { n: p.duo })}</div>`
      : `<div class="flame off">${tx('buddyFlameOut')}</div>`;
    el.innerHTML = `
      <div class="buddy-stat"><span>👤 ${esc(p.name)}</span>
        <span style="color:${p.todayPerfect ? 'var(--ok)' : 'var(--warn)'};font-weight:700">
          ${p.todayPerfect ? tx('buddyTodayDone') : tx('buddyTodayNot')}</span></div>
      <div class="buddy-stat"><span>${tx('buddyStreakLbl')}</span>
        <span style="font-weight:800">${tx('buddyDays', { n: p.streak })}</span></div>
      ${flame}`;
  }

  /* ── 启动:等 renderer 完成首次 loadAll 后初始化 ── */
  async function boot() {
    for (let i = 0; i < 100; i++) {
      if (window.app && (window.app.state.tasks.length || i > 30)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    loadMeta();
    renderSyncUI();
    if (configured()) syncNow(false);
    setInterval(() => { if (configured() && !document.hidden) syncNow(false); }, 90000);
  }
  boot();
})();
