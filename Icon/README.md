# 🎨 Icon 资产与语义图标库

本目录集中管理与托管适用于 Loon / Surge / Quantumult X 的应用图标与任务合集图标。所有资源均托管在个人 GitHub 仓库，免受第三方外部图库失效或拉取阻断影响。

---

## 📁 目录结构规范

```text
Icon/
├── App/                  # 📱 应用原生官方高清图标 (AppIcon 512x512 / 256x256)
│   ├── 10086.png         # 中国移动 官方 AppIcon (512×512)
│   ├── PingMe.png        # PingMe 虚拟号码官方 AppIcon (512×512)
│   ├── ALiYunPan.png     # 阿里云盘 官方 AppIcon (256×256)
│   ├── amapIcon.png      # 高德地图 官方 AppIcon (512×512)
│   ├── hsayIcon.png      # 海信爱家 官方 AppIcon (1280×1280)
│   └── i-maotaiIcon.jpeg # i 茅台 官方 AppIcon (512×512)
├── Task/                 # 🗂️ 任务、合集与功能状态语义图标
│   ├── Daily.png         # 每日打卡 / 签到日历合集图标
│   └── Tasks.png         # 任务总览 / 多合一自动化图标
└── ...                   # 根目录保留同名镜像文件，保证向后完全兼容
```

---

## 🔗 图标直链清单 (Raw CDN)

| 图标名称 | 类别 | 分辨率 | 语义 / 适用插件 | GitHub Raw 链接 |
| :--- | :---: | :---: | :--- | :--- |
| **中国移动** | `App` | 512×512 | `10086.plugin` / 移动每日签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/10086.png` |
| **AkileCloud** | `App` | 512×512 | `akile.plugin` / Akile每日签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/akile.png` |
| **PingMe** | `App` | 512×512 | `pingme.plugin` / PingMe每日签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/PingMe.png` |
| **阿里云盘** | `App` | 256×256 | `aDriveCheckIn.plugin` / 阿里网盘签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/ALiYunPan.png` |
| **高德地图** | `App` | 512×512 | `ampDache.plugin` / 高德打车签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/amapIcon.png` |
| **海信爱家** | `App` | 1280×1280| `hsay.plugin` / 海信爱家签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/hsayIcon.png` |
| **i茅台** | `App` | 512×512 | `i-maotai.plugin` / 茅台申购与签到 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/i-maotaiIcon.jpeg`|
| **每日签到** | `Task`| 144×144 | `tasks.scripts` / 签到任务总合集 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/Task/Daily.png` |
| **定时任务** | `Task`| 144×144 | 通用 Cron 定时任务合集 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/Task/Tasks.png` |

> **提示**：为保证配置向后兼容性，直接引用 `Icon/10086.png` 或 `Icon/App/10086.png` 均可正常加载。
