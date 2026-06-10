# 贡献指南

谢谢你愿意让每日打卡变得更好。这个项目偏轻量，贡献也尽量保持轻量：问题描述清楚、改动范围聚焦、测试能跑起来，就很好。

## 本地开发

```bash
npm install
npm test
npm run web
npm start
```

桌面端使用 Electron + SQLite，浏览器预览端使用 localStorage。改 UI 时建议两个入口都看一下。

## 提交 PR 前

- 跑一遍 `npm test`
- 如果改了渲染、存储或打包配置，确认 `npm start` 能启动
- 如果改了文案，尽量保持中英文 key 对齐
- 不要提交 `dist/`、`node_modules/` 或本地日志

## 代码约定

- `src/shared/core.js` 放纯函数逻辑，保持可测试、无 DOM、无 Electron 依赖
- `src/renderer/renderer.js` 负责 UI 状态和交互，不直接访问 Node API
- `src/electron/main.js` 负责持久化、窗口、安全边界和 IPC
- `src/server/server.js` 负责同步 API、搭子配对和 PWA 静态托管
- 新增持久化字段时，导入导出 JSON 也要同步考虑

## Issue 怎么写更容易被处理

Bug 请尽量包含：

- 运行方式：`npm start` / `npm run web` / 打包后的 exe
- 系统版本和 Node 版本
- 复现步骤
- 期望结果与实际结果
- 控制台报错或截图

功能建议请尽量包含：

- 你想解决的真实场景
- 你希望的交互方式
- 是否会影响已有数据结构

## Commit 建议

不强制格式，但推荐使用清晰前缀：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档
- `test:` 测试
- `chore:` 工程配置
