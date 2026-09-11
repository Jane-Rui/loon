# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-09-11

### Added
- **China Mobile (10086)**: 新增中国移动全自动签到与会话劫持脚本 (`Plugin/10086.js`)。
  - 支持客户端原生 Token 与 H5 SSO 授权握手动态劫持。
  - 支持原生凭证自动 SSO 换票自愈机制，解决会话 30 分钟过期痛点。
  - 支持每日自动打卡与阶梯奖励（流量日包、大奖机会）自动领取。
- **Plugin & Task**: 新增 `Plugin/10086_token_task` 与 `Plugin/10086.plugin` 插件配置。
- **Tasks Scripts**: 新增 `tasks.scripts` 集中订阅合集，支持在 Loon 的 `[Remote Script]` 中一键托管运行。
- **Icon**: 新增中国移动高清图标 `Icon/10086.png`。
- **Documentation**: 新增 `README.md`，提供完整的插件目录说明与安全合规红线声明。
- **PingMe**: 整合 PingMe 虚拟号码与短信平台自动签到及视频激励脚本 (`Plugin/pingme.js`) 与插件配置 (`Plugin/pingme_token_task`、`Plugin/pingme.plugin`)，支持多引擎 OCR 验证码自愈，统一 Qure `PostBox.png` 语义图标。
