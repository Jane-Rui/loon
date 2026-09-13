# Changelog

本项目所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.5.1] - 2026-09-13

### Changed
- **中国移动**：规则 tag 与插件描述更名为「中国移动自动签到」一体化命名（凭据捕获/签到领奖/余量查询已整合为单一脚本单一规则），替代旧「凭据捕获」字样；`Plugin/10086.plugin` 与 `tasks.scripts` 同步。

## [1.5.0] - 2026-09-13

### Changed
- **中国移动 (`Plugin/10086.js` v1.5.0)**：
  - **通知合并**：凭据捕获不再单独推送「授权状态获取成功」弹窗（含重复捕获场景），捕获来源以 `🔑 会话:` 行并入签到结果通知，单次运行仅一条通知；
  - **规则精简**：3 条捕获规则合并为 1 条联合正则（native biz-orange / SSO appTokenLogin / 签到 H5），保留 `requires-body=true` 以维持 SSO Token 体捕获；`Plugin/10086.plugin` 与 `tasks.scripts` 同步；
  - 移除本地测试副本 `Scripts/10086_sign.js`，全仓库仅保留单一脚本文件。
- **AkileCloud (`Plugin/akile.js` v0.13)**：
  - 修复「Token 校验误判通过后又报 token 无效」：网关对失效 Token 返回 `status_code=0 + data=null + status_msg=token无效`，新增 `isAuthOk()/isAuthFailure()` 同时校验状态码、data 与错误文案；
  - 登录态循环策略：Token 优先 → 失效自动账密备用登录并持久化新 Token → 后续接口（资产看板/签到）经 `callWithAuthRetry()` 报失效时自动重登一次并重试。

## [1.4.0] - 2026-09-13

### Changed
- **中国移动 (`Plugin/10086.js` v1.4.0)**：触发方式简化为「捕获即触发」：
  - 移除 10 秒执行窗口与 `cmcc_pending_run_ts`；捕获规则命中并拿到会话 Cookie 时，立即在本次请求上下文内联执行签到、累签领奖与资产查询（`shouldRunOnCapture()`）；
  - 保留执行锁 `cmcc_run_lock_ts`（120 秒）防并发双触发与失败重试节流；当日完成标记 `cmcc_last_run_date` 阻断重复执行；
  - Cron 入口仅响应 `argument` 含 `force` 的手动强制，普通定时触发为空操作（兼容旧配置残留 cron，不会重复签到）。

## [1.3.0] - 2026-09-13

### Changed
- **中国移动 (`Plugin/10086.js` v1.3.0)**：触发方式由「每日固定 Cron」改为「凭据捕获触发，无定时依赖」：
  - 捕获规则命中（APP 打开信号）时保存新鲜凭据并登记「+10 秒执行窗口」（`cmcc_pending_run_ts`），当次请求立即放行；
  - 窗口到期后的下一次捕获请求在其上下文内联执行签到、累签领奖与资产查询（`resolvePendingWindow()` 状态机：done/registered/waiting/run）；
  - 执行锁 `cmcc_run_lock_ts`（120 秒）防并发双触发并节流失败重试；当日成功写入 `cmcc_last_run_date` 后不再触发；
  - Cron 入口仅保留 `argument` 含 `force` 的手动强制执行，普通定时触发为空操作；
  - `Plugin/10086.plugin` 与 `tasks.scripts` 移除全部 10086 Cron，仅保留捕获规则（timeout 30）与注释形式的手动强制示例。

## [1.2.0] - 2026-09-13

### Changed
- **PingMe (`Plugin/pingme.js` v1.1.0)**：广告签到由「每日 2 轮 × 单轮内循环 5 次」调整为「打散为每日 10 次（2×5）独立执行」：
  - 每次 Cron 触发仅完成 1 次 `videoBonus` 广告签到，Cron 调整为 `10:30–14:30` 与 `18:30–22:30` 整点半各 5 次；
  - 新增当日进度持久化键 `pingme_video_progress`（跨次累计、达上限自动跳过、服务端提示无次数时记满防空调度）；
  - 每次运行合并为单条汇总通知，避免打散后通知刷屏；
  - 同步更新 `Plugin/pingme.plugin` 与 `tasks.scripts` 的 Cron 与超时配置。

## [1.1.1] - 2026-09-13

### Added
- **文档**：README 新增 AkileCloud 凭证配置格式说明（`邮箱#密码`，含脱敏示例与插件参数 `account` 填写说明）。

### Fixed
- **AkileCloud (`Plugin/akile.js` v0.12)**：
  - 修正账户余额展示单位：接口返回以「分」为单位，现按官方前端逻辑换算为元并保留两位小数；
  - 修正请求超时参数单位（Loon `$httpClient` 超时单位为毫秒）；
  - 优化 Token 生命周期日志：本地 Token 有效时直接复用，不再重复登录。

### Changed
- **AkileCloud (`Plugin/akile.plugin`)**：移除 MitM 会话捕获规则，凭证统一经插件参数 / `argument` 注入（无需解密 HTTPS）；
- **文档**：`README.md`、`Icon/README.md`、`CHANGELOG.md` 重写为公开仓库文档风格（中性表述、结构化使用说明、隐私与免责声明）。

## [1.1.0] - 2026-09-13

### Added
- **中国移动 (`Plugin/10086.js` v1.1.0)**：签到通知新增账户资产卡片（话费余额 / 通用流量剩余 / 通用通话剩余）。
  - 新增 `cmccBizRequest()` / `queryAccountAssets()` 模块，调用官方 biz-orange 网关 `getRealFee`（IT 20016）与 `getNewPlanRemainQry`（IT 20085）；
  - 请求信封采用 AES-128-CBC 加密，加密与签名函数取自官方 H5 模块 `CMCCService_module_lite`，未自行实现逆向算法；
  - 兼容明文 JSON 与 AES 加密包装两种响应形态；
  - 手机号经本地 `argument=` 或沙盒键 `cmcc_tel` 提供，未配置时自动跳过卡片，不影响签到主流程。

## [1.0.0] - 2026-09-11

### Added
- **中国移动 (`Plugin/10086.js`)**：活动中心每日自动签到、累签阶梯奖励自动领取；客户端原生凭证与 H5 SSO 会话捕获；会话失效自动换票续期；
- **PingMe (`Plugin/pingme.js`)**：每日签到与视频激励任务，多引擎 OCR 验证码识别；
- **AkileCloud (`Plugin/akile.js`)**：每日自动签到，长期 Token 持久化复用与账密自动重登，签到前防重复提交校验；
- **阿里云盘 / 高德打车 / 海信爱家**：对应签到脚本与插件配置；
- **合集订阅**：`tasks.scripts` 定时任务合集，支持 `[Remote Script]` 一键订阅；
- **图标资产**：结构化 `Icon/` 目录（`Icon/App/` 应用图标、`Icon/Task/` 语义图标），根目录保留同名镜像以兼容旧引用；
- **文档**：`README.md` 插件目录、使用说明与安全声明。
