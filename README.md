# Loon 脚本与插件配置合集

本项目托管各类适用于 **Loon**（兼容 Surge、Quantumult X 等环境）的常用自动化脚本、签到任务与规则插件。

---

## ⚠️ 信息安全红线与合规声明

- **严禁向本仓库提交任何私有密钥、Cookie、Token、手机号或个人账号密码等敏感信息。**
- 本仓库所有脚本与插件均严格采用**模板化与动态捕获机制**，所有凭证仅在运行设备的本地沙盒环境（如 `$persistentStore`）中动态写入与读取，不会向任何第三方或云端服务器上报隐私数据。

---

## 📦 定时任务合集订阅（推荐）

在 Loon 的配置文件 `[Remote Script]` 中添加以下订阅链接，即可一键载入合集中的所有定时签到任务：

```ini
https://raw.githubusercontent.com/Jane-Rui/loon/main/tasks.scripts, tag=Jane-Rui定时任务合集, enabled=true
```

---

## 🧩 精选插件与脚本列表

| 功能 / 插件名称 | 插件配置路径 | 核心脚本 | 图标预览 / 路径 | MitM 域名要求 | 说明 |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **中国移动自动签到** | `Plugin/10086.plugin` | `Plugin/10086.js` | `Icon/App/10086.png` | `client.app.coc.10086.cn`<br>`apm.app.coc.10086.cn`<br>`wx.10086.cn` | 自动劫持 APP 登录态，支持原生凭据自动换票续期，每日自动签到并领取流量日包/话费等阶梯奖励 |
| **PingMe 自动签到** | `Plugin/pingme.plugin` | `Plugin/pingme.js` | `Icon/App/PingMe.png` | `api.pingmeapp.net` | 自动抓取 queryBalanceAndBonus 参数，每日定时打卡并自动完成多轮视频激励，内置 OCR 识别验证码 |
| **阿里云盘自动签到** | `Plugin/aDriveCheckIn.plugin` | `Plugin/aDriveCheckIn.js` | `Icon/App/ALiYunPan.png` | `auth.alipan.com`<br>`auth.aliyundrive.com` | 打开阿里网盘 APP 自动捕获凭据，每日定时签到与领取奖励 |
| **高德打车自动签到** | `Plugin/ampDache.plugin` | `Plugin/ampDache.js` | `Icon/App/amapIcon.png` | `*.amap.com` | 打开高德地图打车自动抓取凭据并定时打卡 |
| **海信爱家自动签到** | `Plugin/hsay.plugin` | `Plugin/hsay.js` | `Icon/App/hsayIcon.png` | `*.hisense.com` | 海信爱家打卡与积分获取 |

---

## 🎨 图标资产结构 (`Icon/`)

仓库内设有独立、标准化的图标管理目录，详见 [`Icon/README.md`](Icon/README.md)：
- **`Icon/App/`**：收录各服务官方 512×512 原生高清应用图标（中国移动、PingMe、阿里云盘、高德地图、海信爱家等）；
- **`Icon/Task/`**：收录定时打卡、多任务合集等语义图标（`Daily.png`、`Tasks.png`）。
- **向后兼容**：根目录保留各同名镜像图标文件，保障现有 Loon 配置与旧版引用 100% 顺畅加载。

---

## 📱 中国移动自动签到使用方法

### 1. 安装插件
在 Loon 的【插件】列表中直接添加插件 URL：
```text
https://raw.githubusercontent.com/Jane-Rui/loon/main/Plugin/10086.plugin
```
或使用旧版任务命名：
```text
https://raw.githubusercontent.com/Jane-Rui/loon/main/Plugin/10086_token_task
```

### 2. 授权捕获
1. 确保 Loon 开启且 MitM 证书已处于“受信任”状态；
2. 打开**中国移动 APP**，登录账号，或点击首页【签到】进入签到中心；
3. 弹出系统通知 **「中国移动签到 - 授权状态获取成功」** 即代表凭证已成功保存。

### 3. 自动运行
脚本会在每天 **08:30** 自动执行签到打卡并自动领取累签奖励。若会话凭证失效，脚本将自动发起 SSO 刷新握手，无需反复手动抓包。

---

## 📄 开源许可证

本项目遵循 [MIT License](LICENSE)。
