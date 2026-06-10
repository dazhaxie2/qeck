# 🎯 每日打卡

基于 Electron 的桌面每日打卡应用:自定义任务与每日目标、连续打卡统计、月历视图、成就徽章、JSON 导入导出。

## 使用

```bash
npm install   # 首次
npm start     # 启动应用
npm run build # 打包 Windows 便携版,输出到 dist/
```

## 数据存储

- 数据保存在 SQLite 文件:`%APPDATA%\daily-checkin\daily-checkin.sqlite`
- 每次启动会自动生成备份 `daily-checkin.sqlite.bak`;主库损坏时自动回退到备份
- 也可以在应用内通过「数据管理」导出 / 导入 JSON

## 结构

| 文件 | 作用 |
| --- | --- |
| `main.js` | 主进程:窗口、SQLite(sql.js)存储、语义化 IPC(带输入校验) |
| `preload.js` | contextBridge,只暴露白名单 API,渲染层不能执行原始 SQL |
| `daily-checkin.html` | 全部 UI 与渲染逻辑(单文件) |

## 安全设定

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 页面带 CSP;窗口禁止导航与新窗口弹出
- 单实例锁,避免两个实例互相覆盖数据库
