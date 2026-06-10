# Changelog

## Unreleased

- 整理目录结构：Electron、Renderer、Shared Core、Sync Server 分层放入 `src/`
- 更新脚本、测试、打包清单和文档路径
- 新增运行截图生成脚本 `scripts/capture-preview.js`

## 1.1.0

- 拆出 `core.js`，核心连续打卡、修复券和统计逻辑可单元测试
- 新增 `storage.js`，支持浏览器预览模式
- 新增修复券、热力图、分享卡片、每日提醒等体验能力
- 强化 SQLite 备份与损坏回退
- 强化 Electron 安全配置：隔离上下文、禁用 Node 集成、语义化 IPC
- 补齐 README、贡献指南、路线图、安全说明和 GitHub 协作模板

## 1.0.0

- 初版每日打卡桌面应用
- 支持自定义任务、每日目标、连续统计、月历视图和 JSON 导入导出
