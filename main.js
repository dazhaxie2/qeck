const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(app.getPath('userData'), 'daily-checkin.sqlite');
const BAK_PATH = DB_PATH + '.bak';
let db = null;
let mainWindow = null;

/* ══════════════ 输入校验:渲染进程传来的数据一律先过这里 ══════════════ */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) throw new Error(`非法日期:${d}`);
  return d;
}

function toInt(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`非法数值 ${label}:${v}`);
  return n;
}

function cleanTask(t) {
  const name = String(t?.name ?? '').trim().slice(0, 50);
  if (!name) throw new Error('任务名称不能为空');
  return {
    id: toInt(t.id, 1, 1e9, 'id'),
    name,
    target: toInt(t.target, 1, 999, 'target'),
    unit: String(t.unit ?? '个').trim().slice(0, 10) || '个',
    em: String(t.em ?? '🎯').slice(0, 8),
  };
}

/* ══════════════ 数据库 ══════════════ */
function tryLoad(SQL, file) {
  if (!fs.existsSync(file)) return null;
  try {
    const d = new SQL.Database(fs.readFileSync(file));
    d.exec('SELECT count(*) FROM sqlite_master');
    return d;
  } catch (e) {
    console.error('数据库文件损坏:', file, e);
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch (_) { /* 忽略 */ }
    return null;
  }
}

async function initDB() {
  const SQL = await initSqlJs();
  const existed = fs.existsSync(DB_PATH) || fs.existsSync(BAK_PATH);
  // 主库损坏时回退到上次启动留下的备份
  db = tryLoad(SQL, DB_PATH) || tryLoad(SQL, BAK_PATH) || new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target INTEGER NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT '个',
    em TEXT NOT NULL DEFAULT '🎯'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS records (
    date TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, task_id)
  )`);

  if (!existed) migrateFromJSON();

  saveDB();
  try { fs.copyFileSync(DB_PATH, BAK_PATH); } catch (e) { console.error('写入备份失败:', e); }
}

function migrateFromJSON() {
  const jsonPath = path.join(__dirname, 'daily-checkin.json');
  if (!fs.existsSync(jsonPath)) return;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.tasks || !data.tasks.length) return;
    for (const t of data.tasks) {
      db.run('INSERT OR IGNORE INTO tasks (id, name, target, unit, em) VALUES (?, ?, ?, ?, ?)',
        [t.id, t.name, t.target, t.unit || '个', t.em || '🎯']);
    }
    for (const [date, rec] of Object.entries(data.records || {})) {
      for (const [taskId, value] of Object.entries(rec.tasks || {})) {
        db.run('INSERT OR IGNORE INTO records (date, task_id, value) VALUES (?, ?, ?)',
          [date, parseInt(taskId), value]);
      }
    }
  } catch (e) {
    console.error('JSON migration failed:', e);
  }
}

function saveDB() {
  if (!db) return;
  // 先写临时文件再重命名,写一半被杀也不会损坏原库
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, DB_PATH);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function withTransaction(fn) {
  db.run('BEGIN');
  try {
    fn();
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  saveDB();
}

/* ══════════════ IPC:只暴露语义化操作,不暴露原始 SQL ══════════════ */
function handleIPC() {
  ipcMain.handle('tasks:list', () => queryAll('SELECT * FROM tasks ORDER BY id'));

  ipcMain.handle('tasks:saveAll', (_e, list) => {
    if (!Array.isArray(list) || !list.length) throw new Error('任务列表不能为空');
    const tasks = list.map(cleanTask);
    withTransaction(() => {
      db.run('DELETE FROM tasks');
      for (const t of tasks) {
        db.run('INSERT INTO tasks (id, name, target, unit, em) VALUES (?, ?, ?, ?, ?)',
          [t.id, t.name, t.target, t.unit, t.em]);
      }
    });
    return true;
  });

  ipcMain.handle('records:list', () => queryAll('SELECT * FROM records ORDER BY date'));

  ipcMain.handle('records:set', (_e, date, taskId, value) => {
    assertDate(date);
    const tid = toInt(taskId, 1, 1e9, 'taskId');
    const val = toInt(value, 0, 1e6, 'value');
    withTransaction(() => {
      db.run('INSERT OR REPLACE INTO records (date, task_id, value) VALUES (?, ?, ?)', [date, tid, val]);
    });
    return true;
  });

  ipcMain.handle('records:deleteDate', (_e, date) => {
    assertDate(date);
    withTransaction(() => {
      db.run('DELETE FROM records WHERE date = ?', [date]);
    });
    return true;
  });

  ipcMain.handle('data:export', () => {
    const tasks = queryAll('SELECT * FROM tasks ORDER BY id');
    const records = {};
    for (const r of queryAll('SELECT * FROM records ORDER BY date')) {
      if (!records[r.date]) records[r.date] = { tasks: {} };
      records[r.date].tasks[r.task_id] = r.value;
    }
    return { tasks, records, exportDate: new Date().toISOString(), version: 2 };
  });

  ipcMain.handle('data:import', (_e, data) => {
    const tasks = (Array.isArray(data?.tasks) ? data.tasks : []).map(cleanTask);
    if (!tasks.length) throw new Error('导入数据中没有任务');
    withTransaction(() => {
      db.run('DELETE FROM records');
      db.run('DELETE FROM tasks');
      for (const t of tasks) {
        db.run('INSERT INTO tasks (id, name, target, unit, em) VALUES (?, ?, ?, ?, ?)',
          [t.id, t.name, t.target, t.unit, t.em]);
      }
      for (const [date, rec] of Object.entries(data.records || {})) {
        assertDate(date);
        for (const [taskId, value] of Object.entries(rec?.tasks || {})) {
          db.run('INSERT OR REPLACE INTO records (date, task_id, value) VALUES (?, ?, ?)',
            [date, toInt(Number(taskId), 1, 1e9, 'taskId'), toInt(value, 0, 1e6, 'value')]);
        }
      }
    });
    return true;
  });
}

/* ══════════════ 窗口 ══════════════ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: '🎯 每日打卡',
  });
  mainWindow.loadFile(path.join(__dirname, 'daily-checkin.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ══════════════ 启动:单实例锁,防止两个实例互相覆盖数据库 ══════════════ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.daily.checkin');
    try {
      await initDB();
    } catch (e) {
      dialog.showErrorBox('初始化失败', '数据库初始化失败:' + (e && e.message ? e.message : e));
      app.quit();
      return;
    }
    handleIPC();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
