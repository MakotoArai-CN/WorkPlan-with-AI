<div align="center">

<img src="./src-tauri/icons/icon.png" width=200 height=200>

<h1>WorkPlan With Ai</h1>
  
[![License](https://img.shields.io/badge/license-AGPL3.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.x-red?logo=tauri)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2.x-orange?logo=svelte)
  
融合AI能力的跨平台任务规划与管理系统桌面应用。

</div>

## 🌟 简介

WorkPlan  with AI 是一个现代化的跨平台桌面任务管理和计划制定工具，它结合了人工智能技术，可以根据您的需求自动生成个性化的任务清单和日程安排。本项目受到 [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) 的启发，并在其基础上进行了全面重构和功能增强，从Web应用升级为原生桌面应用。

> 因为是个人开发的项目，而不是团队项目，所以不会对UI进行过多优化，也不会添加过多功能，所以请谅解。本工具也是为没有团队协作的个人用户设计的，因此可能不会考虑做团队化协作的功能。

### 核心特性

- ✅ **智能任务规划**: 利用AI自动生成个性化任务建议
- 📅 **定时任务管理**: 支持设置重复性和定时执行的任务
- ☁️ **云端同步**: 多设备间无缝同步您的数据
- 🔧 **多AI模型支持**: 支持OpenAI、DeepSeek、通义千问等多种主流AI模型
- 🖥️ **原生桌面体验**: 基于Tauri构建，提供接近原生应用的性能和体验
- 🌐 **响应式设计**: 适配各种屏幕尺寸，移动设备友好

## 🎯 功能亮点

### AI驱动的任务生成

利用先进的大语言模型，根据用户输入的简单描述，自动生成详细的任务清单和执行步骤。

### 多维度任务管理

- 今日待办事项看板
- 可复用的任务模板系统
- 自动化定时任务调度
- 数据可视化统计分析

### 灵活的AI集成

支持多种AI服务提供商：

- OpenAI (GPT系列)
- DeepSeek (深度求索)
- 通义千问 (阿里云)
- 智谱清言 (GLM系列)
- 月之暗面 (Kimi)
- Groq (免费快速推理)

> G4F 免费API疑似逆向，可能不稳定，会出现限流等问题，报错`429`，`500`一般是由于API调用次数超限（需要等CD），如需长期稳定使用请使用付费API。

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

> 注意：`@gpt4free`这个依赖库在 npm 仓库的资源是不完整的，需要从[官方的仓库](https://github.com/gpt4free/g4f.dev)拉取，或者复制项目中的`static\@gpt4free`到`node_modules`目录下。

1. 克隆项目仓库：

```bash
git clone https://github.com/MakotoArai-CN/WorkPlan-with-AI.git
cd WorkPlan-with-AI
```

2. 安装依赖：

```bash
bun install
```

3. 配置Supabase：

   > 本项目使用Supabase作为云端数据存储，如果有完全自主可控的云端数据库需要，请自行搭建[Supabase](https://supabase.com/docs)，小白看不懂可以参考这篇博客[手把手自建Supabase服务-墙内](https://ghyghoo8.github.io/2025/03/14/2025-03-14-%E6%89%8B%E6%8A%8A%E6%89%8B%E8%87%AA%E5%BB%BASupabase%E6%9C%8D%E5%8A%A1-%E5%A2%99%E5%86%85/)。

   - 打开[Supabase](https://supabase.com/)，注册账号并创建项目，根据Supabase的引导创建你的项目数据库，完成后点击`connect`即可得到数据库连接信息。
   - 点击项目名称，找到`SQL Editor`，填入建表SQL语句，点击`Run`执行建表操作。

      ```sql
        CREATE TABLE workplan_data (
            id SERIAL PRIMARY KEY,
            user_key TEXT UNIQUE NOT NULL,
            content JSONB,
            updated_at BIGINT 
        );

        CREATE INDEX idx_user_key ON workplan_data(user_key);
      ```

   - 执行`cp .env.example .env`（Windows执行`copy .env.example .env`）填写数据库连接信息：

      ```js
        const SUPABASE_URL = '';               // Supabase URL
        const SUPABASE_KEY = '';               // Supabase Key
        const TABLE_NAME = 'workplan_data';    // Supabase Table Name
      ```

4. 运行开发服务器：

```bash
bun run tauri dev
```

5. 构建生产版本：

```bash
bun run tauri build
```

## 📱 使用指南

### 访问设置

首次使用需要输入Access Key来访问云端数据，您可以输入任意字符串作为Key，或者使用随机生成功能创建。

> 建议使用随机的Access Key，自己设置的话设置的复杂一点，也请不要去爆破Access Key，否则本项目直接关库！

### AI配置

在设置界面中配置您选择的AI服务提供商及其API密钥，即可启用AI辅助功能。

### 任务管理

- 在"今日看板"中管理当天任务
- 使用"任务模板"保存常用任务结构
- 在"定时任务"中设置自动化任务
- 通过"数据统计"查看任务完成情况

## 📁 项目结构

```bash
src/
├── lib/
│   ├── stores/          # Svelte stores 状态管理
│   │   ├── ai.js        # AI相关状态
│   │   ├── modal.js     # 模态框状态
│   │   ├── settings.js  # 设置状态
│   │   └── tasks.js     # 任务状态管理
│   └── utils/
│       └── ai-providers.js  # AI提供商配置
├── routes/              # 页面路由
└── app.css              # 全局样式
src-tauri/
├── src/                 # Rust源码
├── Cargo.toml           # Rust依赖配置
└── tauri.conf.json      # Tauri配置
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
- [G4F](https://g4f.cn/)

## Todolist

- [ ] 新增多语言支持（超 100 star 就加入 i18 国际化）
- [ ] 新增右键优化，增加快捷键功能（待定）
- [ ] 新增代码块快捷复制功能
- [ ] AI Chat 加入任务接口，触发关键词后进行任务的查询等（待定）
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
