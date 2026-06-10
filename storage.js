/* ══════════════════════════════════════════════════════════════
   storage.js — 浏览器模式存储适配器(localStorage)
   与 preload.js 暴露的 window.api 接口完全一致,
   使同一份页面既能跑在 Electron(SQLite),也能直接部署为网页 / PWA。
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const K = {
    tasks: 'dc_tasks',
    records: 'dc_records',
    frozen: 'dc_frozen',
    settings: 'dc_settings',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  root.createLocalAdapter = function createLocalAdapter() {
    return {
      async getTasks() {
        return read(K.tasks, []);
      },
      async saveTasks(tasks) {
        if (!Array.isArray(tasks) || !tasks.length) throw new Error('empty tasks');
        write(K.tasks, tasks);
        return true;
      },
      async getRecords() {
        // 与 SQLite 返回形状一致:[{date, task_id, value}]
        const recs = read(K.records, {});
        const rows = [];
        for (const [date, rec] of Object.entries(recs)) {
          for (const [taskId, value] of Object.entries(rec.tasks || {})) {
            rows.push({ date, task_id: Number(taskId), value });
          }
        }
        return rows;
      },
      async setRecord(date, taskId, value) {
        const recs = read(K.records, {});
        if (!recs[date]) recs[date] = { tasks: {} };
        recs[date].tasks[taskId] = value;
        write(K.records, recs);
        return true;
      },
      async deleteDateRecords(date) {
        const recs = read(K.records, {});
        delete recs[date];
        write(K.records, recs);
        return true;
      },
      async getSettings() {
        return read(K.settings, {});
      },
      async setSetting(key, value) {
        const s = read(K.settings, {});
        s[key] = String(value);
        write(K.settings, s);
        return true;
      },
      async getFrozen() {
        return read(K.frozen, []);
      },
      async addFrozen(date) {
        const f = read(K.frozen, []);
        if (!f.includes(date)) f.push(date);
        write(K.frozen, f.sort());
        return true;
      },
      async exportJSON() {
        return {
          tasks: read(K.tasks, []),
          records: read(K.records, {}),
          frozen: read(K.frozen, []),
          settings: read(K.settings, {}),
          exportDate: new Date().toISOString(),
          version: 3,
        };
      },
      async importJSON(data) {
        if (!Array.isArray(data?.tasks) || !data.tasks.length) throw new Error('no tasks');
        write(K.tasks, data.tasks);
        write(K.records, data.records || {});
        write(K.frozen, Array.isArray(data.frozen) ? data.frozen : []);
        write(K.settings, data.settings || {});
        return true;
      },
    };
  };
})(typeof self !== 'undefined' ? self : this);
