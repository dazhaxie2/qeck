# Security Policy

每日打卡是离线优先工具，默认不会把用户数据上传到任何服务器。

## 数据位置

桌面版数据位于 Electron `userData` 目录：

```text
%APPDATA%\daily-checkin\daily-checkin.sqlite
```

浏览器预览版使用当前浏览器的 localStorage。

## 安全边界

- 渲染进程不直接访问 Node API
- `preload.js` 只暴露白名单 API
- IPC 不暴露原始 SQL
- 输入会在主进程做基础校验
- 窗口禁止导航与新窗口弹出

## 报告安全问题

如果你发现安全问题，请不要先公开利用细节。建议通过 GitHub 私下联系维护者，或者在 issue 中只描述影响范围和联系方式。

报告时请尽量包含：

- 影响版本
- 复现步骤
- 可能影响的数据范围
- 建议修复方向
