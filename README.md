<div align="center">

<img src="./src-tauri/icons/icon.png" width=200 height=200>

<h1>WorkPlan With Ai</h1>
  
[![License](https://img.shields.io/badge/license-AGPL3.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.x-red?logo=tauri)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2.x-orange?logo=svelte)
  
融合AI能力的跨平台任务规划与管理系统桌面应用。

当前版本：`0.3.0`

</div>

## 🌟 简介

WorkPlan  with AI 是一个现代化的跨平台桌面任务管理和计划制定工具，它结合了人工智能技术，可以根据您的需求自动生成个性化的任务清单和日程安排。本项目受到 [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) 的启发，并在其基础上进行了全面重构和功能增强，从Web应用升级为原生桌面应用。

> 因为是个人开发的项目，而不是团队项目，所以不会对UI进行过多优化，也不会添加过多功能，所以请谅解。本工具也是为没有团队协作的个人用户设计的，因此可能不会考虑做团队化协作的功能。

## 0.3.0 重要变更

`0.3.0` 不是一次小修小补，而是一次围绕 AI 工作流、桌面交互和可扩展能力的结构升级。升级后建议先阅读下面几项：

- `AI 助手 / AI Chat`：右侧 AI 助手已经统一接入任务看板、任务模板、定时任务、数据统计和工作笔记；AI Chat 也升级为完整会话模式，支持历史记录、多会话和更完整的项目功能调用入口。
- `G4F 接入`：G4F 已恢复为从仓库根目录 `g4f.dev/dist` 载入，当前固定为 `0.2.7` 对应资源。无论本地开发还是 CI / 发布构建，都需要保证 `dist/js/providers.json` 与 `dist/js/client.js` 可用。
- `本地工具权限`：AI 现在可以调用网页搜索和本地文件工具。读取、扫描、搜索遵循当前运行权限；写入、修改、删除仅允许工作目录以及用户显式授权的目录，且可要求二次确认。
- `数据库配置`：系统设置默认使用内置数据库配置，只有启用自定义配置时才展开具体字段。README 和设置页同时补充了数据库服务目录、容量说明以及自托管建表 SQL。
- `桌面交互`：左侧导航支持折叠，右侧详情 / AI 面板改为按需展开；工作笔记的 AI 入口统一到了右侧助手，交互逻辑与任务看板保持一致。

### 核心特性

- ✅ **统一 AI 助手与 AI Chat**: 任务、模板、定时、统计、笔记都可从上下文直接唤起 AI
- 📅 **多维度任务管理**: 支持任务看板、任务模板、定时任务、数据统计和工作笔记
- ☁️ **内置 / 自定义数据库同步**: 支持内置同步配置，也支持自定义 HTTP API / PostgREST 类接口
- 🔧 **多模型与 G4F 支持**: 支持主流模型服务、自定义 Base URL / API Key、多连接保存，以及根目录 `g4f.dev/dist` 接入
- 🧰 **项目工具能力**: AI 可调用任务管理、笔记整理、密码信息辅助、网页搜索和受限本地文件操作
- 🖥️ **原生桌面体验**: 基于 Tauri 构建，提供接近原生应用的性能和体验

## 🎯 功能亮点

### AI驱动的任务生成

利用先进的大语言模型，根据用户输入的简单描述，自动生成详细的任务清单和执行步骤。

### 多维度任务管理

- 今日待办事项看板
- 可复用的任务模板系统
- 自动化定时任务调度
- 数据可视化统计分析

### 灵活的AI集成

支持多种 AI 服务提供商与接入方式：

- OpenAI (GPT系列)
- DeepSeek (深度求索)
- 通义千问 (阿里云)
- 智谱清言 (GLM系列)
- 月之暗面 (Kimi)
- Groq (免费快速推理)
- Ollama / LM Studio
- G4F (`g4f.dev/dist`, 0.2.7)
- 自定义 OpenAI 兼容接口

## 🛠 技术架构

### 前端技术栈

- [SvelteKit](https://kit.svelte.dev/) - 基于Svelte的全功能框架
- [Tauri](https://tauri.app/) - 构建安全、快速的原生应用
- [Tailwind CSS](https://tailwindcss.com/) - 实用优先的CSS框架
- [Phosphor Icons](https://phosphoricons.com/) - 精美的开源图标库
- [Supabase](https://supabase.com/) - 开源的Firebase替代品

### 后端与基础设施

- [Rust](https://www.rust-lang.org/) - Tauri应用的核心语言
- [Supabase](https://supabase.com/) - 云端数据存储和同步

### AI集成方案

不同于原项目使用的Vercel边缘函数，本项目采用直接API调用方式与各大AI服务商通信，提供更稳定、可控的服务体验。

## 🚀 快速开始

### 系统要求

- Node.js 16+ / bun v1.2.0+
- Rust toolchain (会自动安装)
- 对应操作系统的开发工具链:
  - Windows: WebView2 (Windows 10+ 默认包含)
  - macOS: Xcode command line tools
  - Linux: WebKit2GTK (例如 Ubuntu/Debian 上的 `webkit2gtk-4.0`)

### 安装步骤

> 注意：G4F 资源从仓库根目录的 `g4f.dev\dist` 接入，本版本固定使用 `0.2.7` 对应资源。本地开发需要该目录存在；GitHub Release 工作流会从 `MakotoArai-CN/g4f.dev` 的固定提交拉取 `dist` 目录，并在构建前校验 `dist/js/providers.json` 与 `dist/js/client.js`。

1. 克隆项目仓库：

```bash
git clone https://github.com/MakotoArai-CN/WorkPlan-with-AI.git
cd WorkPlan-with-AI
```

2. 安装依赖：

```bash
bun install
```

3. 配置数据库（推荐 Supabase / 自托管 PostgREST）：

   > 现在支持两种接入方式：
   > 1. 继续通过 `.env` 预置默认数据库地址。
   > 2. 在应用的“系统设置 → 数据库配置”中直接填写数据库服务、URL、API Key、表名，并持久化保存。
   >
   > 当前客户端直接支持 `Supabase / 自托管 PostgREST 兼容 HTTP API`。  
   > Neon、Nhost、Turso、PocketBase、Appwrite、Firebase 已在设置页内提供容量说明、接入信息保存位和建表文档，其中 PostgreSQL 类服务建议通过 Supabase 或 PostgREST 暴露 HTTP API 后再接入本客户端。

   - 打开[Supabase](https://supabase.com/) 或你自己的自托管 Supabase / PostgREST 服务，创建项目并拿到 API 地址与 Key。
   - 点击项目名称，找到 `SQL Editor`，填入建表 SQL 语句，点击 `Run` 执行建表操作。

      ```sql
        CREATE TABLE IF NOT EXISTS planpro_data (
            id BIGSERIAL PRIMARY KEY,
            user_key TEXT UNIQUE NOT NULL,
            content JSONB,
            updated_at BIGINT
        );

        CREATE INDEX IF NOT EXISTS idx_planpro_user_key ON planpro_data(user_key);
      ```

   - 如果你想给开发环境设置默认数据库，执行 `cp .env.example .env`（Windows 执行 `copy .env.example .env`）填写数据库连接信息：

      ```js
        const SUPABASE_URL = '';               // Supabase URL
        const SUPABASE_KEY = '';               // Supabase Key
        const TABLE_NAME = 'planpro_data';     // Supabase Table Name
      ```

   - 如果你想在应用内切换数据库：
     - 打开“系统设置”
     - 进入“数据库配置”
     - 选择服务商
     - 填写 `HTTP API / 项目地址`、`API Key / Token`、`数据表名`
     - 开启“启用云同步”

   - 自托管 PostgreSQL 推荐做法：
     - 先执行上面的建表 SQL
     - 再通过 PostgREST / Supabase 兼容网关暴露 HTTP API
     - 最后把网关 URL 和 Key 填到设置页中

4. 运行开发服务器：

```bash
bun run tauri dev
```

5. 构建生产版本：

```bash
bun run tauri build
```

> 注意：Windows 下如果项目目录包含中文等非 ASCII 路径，Android NDK/LLVM 链接阶段可能失败。遇到这种情况，请将项目放到纯英文路径后再执行 `bun run tauri android ...`。

## 📱 使用指南

### 访问设置

首次使用需要输入Access Key来访问云端数据，您可以输入任意字符串作为Key，或者使用随机生成功能创建。

> 建议使用随机的Access Key，自己设置的话设置的复杂一点，也请不要去爆破Access Key，否则本项目直接关库！

### AI配置

在设置界面中配置您选择的 AI 服务提供商及其 API 密钥，即可启用 AI 辅助功能。

- 现在支持保存多个 AI 连接配置，每个连接会分别保存：
  - 服务商
  - 模型
  - Base URL / Endpoint
  - API Key / Secret Key
  - G4F 模型提供商设置
- G4F 接入方式已经恢复为从仓库根目录的 `g4f.dev/dist` 载入。
- 任务看板、任务模板、定时任务、数据统计、工作笔记均可直接打开右侧 AI 助手，AI Chat 则用于完整多轮会话。
- AI 支持调用网页搜索和本地文件工具；本地敏感写操作受工作目录 / 信任目录与确认策略限制。

### 任务管理

- 在"今日看板"中管理当天任务
- 使用"任务模板"保存常用任务结构
- 在"定时任务"中设置自动化任务
- 通过"数据统计"查看任务完成情况
- 在"工作笔记"中使用统一右侧 AI 助手进行总结、续写、提炼行动项

## 📁 项目结构

```bash
WorkPlan-with-ai/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── AgreementModal.svelte
│   │   │   ├── AiChat.svelte
│   │   │   ├── AiPanel.svelte
│   │   │   ├── AiSettings.svelte
│   │   │   ├── Charts.svelte
│   │   │   ├── ContextMenu.svelte
│   │   │   ├── Dashboard.svelte
│   │   │   ├── GanttChart.svelte
│   │   │   ├── GlobalModal.svelte
│   │   │   ├── LoginModal.svelte
│   │   │   ├── MarkdownRenderer.svelte
│   │   │   ├── MobileNav.svelte
│   │   │   ├── MobileTaskDetail.svelte
│   │   │   ├── MoreMenu.svelte
│   │   │   ├── Notes.svelte
│   │   │   ├── Passwords.svelte
│   │   │   ├── Scheduled.svelte
│   │   │   ├── Settings.svelte
│   │   │   ├── Sidebar.svelte
│   │   │   ├── SplashScreen.svelte
│   │   │   ├── Statistics.svelte
│   │   │   ├── TaskCard.svelte
│   │   │   ├── TaskDetail.svelte
│   │   │   ├── TaskModal.svelte
│   │   │   └── Templates.svelte
│   │   ├── stores/
│   │   │   ├── ai.js
│   │   │   ├── modal.js
│   │   │   ├── navigation.js
│   │   │   ├── notes.js
│   │   │   ├── passwords.js
│   │   │   ├── settings.js
│   │   │   └── tasks.js
│   │   └── utils/
│   │       ├── ai-providers.js
│   │       ├── crypto.js
│   │       ├── database-providers.js
│   │       ├── export.js
│   │       ├── g4f-client.js
│   │       ├── local-file-tools.js
│   │       ├── markdown.js
│   │       ├── open-external.js
│   │       ├── textarea-autosize.js
│   │       └── web-search.js
│   ├── routes/
│   │   ├── +error.svelte
│   │   ├── +layout.js
│   │   ├── +layout.svelte
│   │   ├── +page.js
│   │   └── +page.svelte
│   ├── app.css
│   └── app.html
├── src-tauri/
│   ├── capabilities/
│   │   └── default.json
│   ├── src/
│   │   ├── autostart.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .env.example
├── README.md
├── jsconfig.json
├── package.json
├── postcss.config.js
├── svelte.config.js
└── vite.config.js
```

## 🤝 贡献指南

我们欢迎任何形式的贡献！无论是报告bug、提出新功能还是提交代码改进，请遵循以下步骤：

1. Fork项目
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个Pull Request

## 🙏 致谢

特别感谢 [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) 项目为我们提供了灵感和基础架构参考。

同时也感谢以下开源项目：

- [SvelteKit](https://kit.svelte.dev/)
- [Tauri](https://tauri.app/)
- [Supabase](https://supabase.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Phosphor Icons](https://phosphoricons.com/)

## Todolist

- [ ] 继续扩展更多语言包与翻译质量
- [x] 修复移动端没有备份/恢复，切换账号，删库跑路的bug
- [x] 修复右键菜单点击粘贴后粘贴选项会立即消失，然后变成创建任务,点击实际点击到的是创建任务，不是粘贴文本到文本框的bug
- [ ] 修复Vditor的快捷键气泡提示被遮挡的bug，修复Vditor文件上传问题
- [x] 新增配置AI 的API key保存的API key等信息自动同步到密码本的功能
- [x] 新增右键优化，增加快捷键功能（待定）
- [x] 新增代码块快捷复制功能
- [x] 新增表格，支持更多的数据可视化
- [x] 优化移动端UI
- [x] 新增AI 报告生成自定义提示词
- [x] 添加AI管理任务功能，增删改查任务
- [x] 适配移动设备
- [x] 为账号新增保护功能
- [x] 新增更多AI功能（任务总结，日/周报生成等）

## 📄 许可证

本项目采用AGPL-3.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🔒 免责声明

本项目仅供个人学习和研究使用，不提供任何商业用途保证。用户需自行承担使用风险，并遵守各AI服务提供商的使用条款。
