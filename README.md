# loon

适用于 **Loon** 的自动化脚本与插件合集（兼容 Surge、Quantumult X 的部分语法），覆盖每日签到、任务打卡、会话凭证本地化管理等场景。

所有脚本遵循统一设计：**凭证本地沙盒存储 + 定时任务执行 + 系统通知反馈**，仓库内不包含任何账号、密码、Cookie 或 Token。

---

## 目录结构

```text
.
├── Plugin/            # 各服务脚本与插件配置（*.js / *.plugin）
├── Icon/              # 图标资产目录（结构说明见 Icon/README.md）
├── tasks.scripts      # 定时任务合集订阅文件
├── CHANGELOG.md       # 版本变更记录
├── LICENSE            # MIT License
└── README.md
```

---

## 快速开始

1. **环境要求**：已安装 Loon，并开启 MitM（HTTPS 解密），且系统已信任 Loon 证书；
2. **订阅方式**（二选一）：
   - 合集订阅（推荐）：在配置 `[Remote Script]` 中添加
     ```ini
     https://raw.githubusercontent.com/Jane-Rui/loon/main/tasks.scripts, tag=定时任务合集, enabled=true
     ```
   - 单插件订阅：在【插件】中添加对应 `.plugin` 链接（见下表）；
3. **凭证捕获**：订阅后打开一次对应 APP（或进入对应活动页），脚本通过 MitM 自动捕获并本地持久化会话凭证，成功时弹出系统通知；
4. **定时执行**：凭证就绪后按各插件内置 cron 自动签到，结果以系统通知推送；会话过期时脚本自动续期，无需重复抓包。

---

## 插件列表

| 服务 | 插件配置 | 核心脚本 | 图标 | MitM 域名 | 功能说明 |
| :--- | :--- | :--- | :---: | :--- | :--- |
| 中国移动 | `Plugin/10086.plugin` | `Plugin/10086.js` | `Icon/App/10086.png` | `client.app.coc.10086.cn`<br>`apm.app.coc.10086.cn`<br>`wx.10086.cn` | 活动中心每日签到、累签阶梯奖励自动领取；会话凭证自动续期；可选账户资产卡片（话费 / 流量 / 通话余量） |
| PingMe | `Plugin/pingme.plugin` | `Plugin/pingme.js` | `Icon/App/PingMe.png` | `api.pingmeapp.net` | 每日签到打卡与视频激励任务，内置多引擎 OCR 验证码识别 |
| AkileCloud | `Plugin/akile.plugin` | `Plugin/akile.js` | `Icon/App/akile.png` | 无需 MitM | 每日签到；长期 Token 优先复用，失效时账密自动重登；签到前防重复提交校验 |
| 阿里云盘 | `Plugin/aDriveCheckIn.plugin` | `Plugin/aDriveCheckIn.js` | `Icon/App/ALiYunPan.png` | `auth.alipan.com`<br>`auth.aliyundrive.com` | 每日签到与奖励领取 |
| 高德打车 | `Plugin/ampDache.plugin` | `Plugin/ampDache.js` | `Icon/App/amapIcon.png` | `*.amap.com` | 每日打卡 |
| 海信爱家 | `Plugin/hsay.plugin` | `Plugin/hsay.js` | `Icon/App/hsayIcon.png` | `*.hisense.com` | 每日打卡与积分获取 |

---

## 使用说明

### 中国移动（10086）

**凭证捕获**

1. 开启 MitM 并信任证书；
2. 打开中国移动 APP 并登录，或进入首页【签到】；
3. 收到「中国移动签到 - 授权状态获取成功」通知即完成捕获。

**触发方式（v1.4.0 起为捕获即触发，无定时任务、无延迟窗口）**

- 打开中国移动 APP 时捕获规则命中并保存会话 Cookie，**随即在同一次请求的脚本上下文内联执行**签到、累签领奖与话费/流量/通话资产查询（该请求仅被持有签到耗时约数秒）；
- 凭据为刚刚捕获的新鲜登录态，无需定时执行时的重新登录握手；
- 执行锁（120 秒）防止并发双触发并节流失败重试；当日签到成功后不再触发，失败则留待下次捕获自动重试；
- 无需配置任何 Cron 即可工作；如需手动立即执行：使用带 `#force` 控制位的配置行运行一次（见下）。

**账户资产卡片（可选，v1.1.0+）**

签到通知可附带话费余额、通用流量剩余、通用通话剩余。该查询接口服务端校验手机号，需一次性登记（仅写入本机沙盒键 `cmcc_tel`，不上传、不入库）：

1. 在配置 `[Script]` 中添加（替换 `argument` 为「11 位手机号#force」）：
   ```ini
   cron "0 0 31 2 *" script-path=https://raw.githubusercontent.com/Jane-Rui/loon/main/Plugin/10086.js, timeout=60, tag=10086号码登记与手动执行, argument=手机号#force, enabled=true
   ```
   该 cron（2 月 31 日）不会自动触发；手动运行一次即登记手机号并立即执行签到（`force` 控制位无视监听窗口与当日完成状态）；
2. 在 Loon 脚本列表中手动运行一次，收到带资产卡片的通知即登记成功；
3. 删除该临时行。未登记时签到主流程不受影响，仅不展示资产卡片。

### 其他服务

- **PingMe / 阿里云盘 / 高德打车 / 海信爱家**：订阅插件后打开一次对应 APP 完成凭证捕获，随后按内置 cron 自动执行；
- **AkileCloud**：无需 MitM，凭证配置方式见下。

### AkileCloud（akile.ai）

**凭证配置格式**

账号凭证通过插件参数或脚本 `argument` 注入，格式为：

```text
邮箱#密码
```

（兼容 `邮箱,密码`；密码中若含 `#` 或 `,`，以第一个分隔符之前的部分为邮箱、其余整体作为密码。）

脱敏示例（实际使用时请在本机替换为真实值，切勿将真实凭证提交到任何公开仓库）：

```ini
cron "15 9 * * *" script-path=https://raw.githubusercontent.com/Jane-Rui/loon/main/Plugin/akile.js, timeout=60, tag=AkileCloud每日签到, argument=j***o@example.com#p********d, enabled=true
```

- 使用 `.plugin` 订阅时，Loon 会提示填写插件参数 `account`，按同一格式输入即可；
- 凭证仅保存在本机配置 / `$persistentStore` 沙盒中；
- 登录成功后 Token 持久化复用（有效期 24 小时），过期或 IP 变动失效时自动以账密静默重登；
- 签到前校验东八区当日是否已打卡，已打卡则熔断拦截重复请求。

---

## 隐私与安全

- 仓库内**不含**任何密钥、Cookie、Token、手机号或账号密码；所有示例配置均为占位符；
- 会话凭证仅存储于运行设备的 `$persistentStore` 本地沙盒，脚本不向任何第三方上报数据；
- 脚本仅向对应服务的官方域名发起请求；
- 通过 `argument=` 传入的账号参数仅保存在用户本机配置或沙盒中。

## 免责声明

- 本项目仅供学习与技术研究使用；使用本仓库脚本请自行遵守对应服务的服务条款，因使用产生的账号风险由使用者自行承担；
- 脚本依赖的接口与页面结构来自各服务公开资源，官方调整后脚本可能失效，以实际运行结果为准；
- 文中涉及的服务名称、商标与图标版权归原作者或权利方所有，本仓库图标仅用于配置项展示。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT License](LICENSE)
