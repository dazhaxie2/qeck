const { contextBridge, ipcRenderer } = require('electron');

// 只暴露语义化 API,渲染进程无法执行任意 SQL
contextBridge.exposeInMainWorld('api', {
  getTasks: () => ipcRenderer.invoke('tasks:list'),
  saveTasks: (tasks) => ipcRenderer.invoke('tasks:saveAll', tasks),
  getRecords: () => ipcRenderer.invoke('records:list'),
  setRecord: (date, taskId, value) => ipcRenderer.invoke('records:set', date, taskId, value),
  deleteDateRecords: (date) => ipcRenderer.invoke('records:deleteDate', date),
  getSettings: () => ipcRenderer.invoke('settings:all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getFrozen: () => ipcRenderer.invoke('frozen:list'),
  addFrozen: (date) => ipcRenderer.invoke('frozen:add', date),
  exportJSON: () => ipcRenderer.invoke('data:export'),
  importJSON: (data) => ipcRenderer.invoke('data:import', data),
});
