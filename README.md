# 🚀 FlarePortal - 极简云端服务导航

<div align="center">

**极简、高颜值、高性能的云端导航门户**
*数据与代码分离 · 隐私安全 · 零成本部署*

</div>

---

## 📖 项目简介

**FlarePortal** (原 NooMiNav) 是一个基于 Cloudflare 生态构建的现代化导航站。它采用了 **配置与代码解耦** 的设计：你的所有链接、密码和配置都存储在 Cloudflare 环境变量中，GitHub 仓库仅包含纯净的业务逻辑。

### ✨ 核心特性

* 🎨 **高颜值 UI**：原生毛玻璃（Glassmorphism）特效，完美适配移动端与桌面端。
* 🛡️ **隐私安全**：代码库不含任何敏感数据，防止 Git 泄露隐私。
* ⚡ **双模部署**：同时支持 **Cloudflare Pages (推荐)** 和 Workers。
* 📊 **全能数据看板**：
* **实时统计**：PV、总点击、月点击、**今日点击** (New)。
* **访问日志**：记录详细的点击时间、IP 地址 (New) 和设备信息。
* **无需频繁登录**：后台支持 30 天免登录保持。


* 🔗 **高可用**：支持配置“备用链接”，主线路故障自动切换。
* 🛠️ **本地测试**：提供完整的本地模拟环境，方便二次开发。

---

## ⚙️ 第一步：环境变量配置

请在 Cloudflare Pages/Workers 的 **Settings** -> **Environment variables** 中添加以下变量：

### 1. 核心变量表

| 变量名 | 必填 | 说明 | 示例值 |
| --- | --- | --- | --- |
| **`admin`** | ✅ | 后台管理密码 (访问 `/admin` 用) | `MySecretPass123` |
| **`LINKS`** | ✅ | **主导航数据** (JSON 格式) | *见下方模板* |
| **`FRIENDS`** | ❌ | **友链数据** (JSON 格式) | *见下方模板* |
| **`TITLE`** | ❌ | 网站标题 | `我的导航站` |
| **`SUBTITLE`** | ❌ | 网站副标题 | `随时畅联 · 优质资源` |
| **`img`** | ❌ | 背景图片 URL | `https://example.com/bg.jpg` |

### 2. JSON 配置模板 (复制修改)

#### `LINKS` (主导航)

> **注意：** `id` 建议使用英文，`backup_url` 为可选的备用跳转地址。

```json
[
  {
    "id": "github",
    "name": "GitHub",
    "emoji": "PJ",
    "note": "代码托管平台",
    "url": "https://github.com",
    "backup_url": "https://github.io"
  },
  {
    "id": "youtube",
    "name": "YouTube",
    "emoji": "Cf",
    "note": "视频流媒体",
    "url": "https://www.youtube.com"
  }
]

```

#### `FRIENDS` (底部友链)

> **注意：** 必须包含 `id` 字段用于统计点击量。

```json
[
  {
    "id": "cloudflare",
    "name": "Cloudflare",
    "url": "https://www.cloudflare.com"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "url": "https://openai.com"
  }
]

```

---

## 🔌 第二步：绑定 D1 数据库

1. 在 Cloudflare 后台创建一个新的 **D1 数据库** (例如命名为 `nav_db`)。
2. 进入你的 Pages 或 Worker 项目设置：
* **Pages**: Settings -> Functions -> D1 Database Bindings
* **Workers**: Settings -> Variables -> D1 Database Bindings


3. 添加绑定：
* **Variable name (变量名)**: 填写 **`db`** (必须小写)。
* **Namespace**: 选择你刚才创建的数据库。


4. **重要**：绑定完成后，务必 **重新部署项目 (Retry Deployment)** 以便生效。

---

## 💻 第三步：数据库初始化 (重要)

**绑定并重新部署后**，请进入 D1 数据库的 **Console (控制台)** 标签页，**按顺序**执行以下 SQL 语句来创建表结构：

### 1. 创建日志表 (Logs)

> 包含 IP 和 UA 记录功能

```sql
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT,
    click_time TEXT,
    month_key TEXT,
    ip_address TEXT DEFAULT 'unknown',
    user_agent TEXT DEFAULT 'unknown'
);

```

### 2. 创建统计表 (Stats)

> 包含今日点击 (day_clicks) 和日期记录

```sql
CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    total_clicks INTEGER DEFAULT 0,
    year_clicks INTEGER DEFAULT 0,
    month_clicks INTEGER DEFAULT 0,
    day_clicks INTEGER DEFAULT 0,
    last_year TEXT,
    last_month TEXT,
    last_day TEXT,
    last_time TEXT
);

```

### 3. 创建索引 (优化性能)

```sql
CREATE INDEX IF NOT EXISTS idx_logs_link_month ON logs(link_id, month_key);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(click_time);

```

---

## 🚀 部署指南

### 推荐：Cloudflare Pages

1. **Fork** 本仓库。
2. 在 Cloudflare Dashboard 创建 **Pages** 项目 -> **Connect to Git**。
3. 按照上述说明配置 **环境变量** 和 **D1 绑定**。
4. 执行数据库初始化 SQL。
5. **访问 `/admin**` 验证后台是否正常。

### 可选：Cloudflare Workers

1. 复制 `functions/[[path]].js` 的代码。
2. 创建 Worker，粘贴代码。
3. 配置环境变量和 D1 绑定。

---

## 🛠️ 本地开发与测试

本项目包含完整的本地模拟环境，无需部署即可体验所有功能。

1. 进入 `本地测试专用` 目录。
2. 运行安装脚本：
* Windows: 双击 `install_dependencies.bat`
* Mac/Linux: 运行 `npm install express`


3. 启动服务器：
* Windows: 双击 `start_local_test.bat`
* Mac/Linux: 运行 `node local_server_full_cf_simulation.js`


4. 访问 `http://localhost:8787` 即可预览。

---

## 📄 开源协议

基于 [MIT License](https://www.google.com/search?q=LICENSE) 开源。欢迎 Star ⭐！
