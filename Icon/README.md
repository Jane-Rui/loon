# Icon 资产目录

本目录存放仓库内脚本与插件配置引用的图标资源，统一由本仓库托管，避免外部图床失效导致的加载失败。

## 目录结构

```text
Icon/
├── App/                  # 应用图标（各服务官方 AppIcon）
│   ├── 10086.png         # 中国移动（512×512）
│   ├── akile.png         # AkileCloud（512×512）
│   ├── PingMe.png        # PingMe（512×512）
│   ├── ALiYunPan.png     # 阿里云盘（256×256）
│   ├── amapIcon.png      # 高德地图（512×512）
│   ├── hsayIcon.png      # 海信爱家（1280×1280）
│   └── i-maotaiIcon.jpeg # i 茅台（512×512）
├── Task/                 # 任务 / 合集语义图标
│   ├── Daily.png         # 每日签到合集（144×144）
│   └── Tasks.png         # 定时任务合集（144×144）
└── *.png                 # 根目录同名镜像，用于兼容历史引用
```

## 引用清单

| 名称 | 类别 | 分辨率 | 适用配置 | 引用地址 |
| :--- | :---: | :---: | :--- | :--- |
| 中国移动 | App | 512×512 | `10086.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/10086.png` |
| AkileCloud | App | 512×512 | `akile.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/akile.png` |
| PingMe | App | 512×512 | `pingme.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/PingMe.png` |
| 阿里云盘 | App | 256×256 | `aDriveCheckIn.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/ALiYunPan.png` |
| 高德地图 | App | 512×512 | `ampDache.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/amapIcon.png` |
| 海信爱家 | App | 1280×1280 | `hsay.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/hsayIcon.png` |
| i 茅台 | App | 512×512 | `i-maotai.plugin` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/i-maotaiIcon.jpeg` |
| 每日签到 | Task | 144×144 | `tasks.scripts` | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/Task/Daily.png` |
| 定时任务 | Task | 144×144 | 通用 cron 合集 | `https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/Task/Tasks.png` |

## 兼容性说明

- 历史配置中引用 `Icon/<name>.png` 与 `Icon/App/<name>.png` 均有效（根目录保留同名镜像）；
- 新增图标请放入对应子目录，并同步更新本清单。

## 版权说明

目录内应用图标版权归原作者或权利方所有，本仓库仅作为代理配置项的展示资源引用。
