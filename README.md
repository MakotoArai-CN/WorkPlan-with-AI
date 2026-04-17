<div align="center">

<img src="./src-tauri/icons/icon.png" width=200 height=200>

<h1>WorkPlan With Ai</h1>
  
[![License](https://img.shields.io/badge/license-AGPL3.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.x-red?logo=tauri)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2.x-orange?logo=svelte)
  
融合AI能力的跨平台任务规划与管理系统。

</div>

## 简介

WorkPlan with AI 是一个跨平台的任务管理和计划制定工具，支持 Windows、macOS、Linux 和 Android。通过接入大语言模型，可以根据简单的文字描述自动生成任务清单、拆分子步骤、搜索网页资料，也可以读写本地文件辅助日常工作。本项目受到 [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) 的启发，在其基础上从 Web 应用重构为基于 Tauri 2 的原生桌面/移动端应用。

> 个人项目，不做过度的 UI 打磨，也暂不考虑团队协作功能。

### 主要功能

- **AI 助手 + AI Chat**：任务看板、模板、定时任务、统计、笔记均可唤起右侧 AI 助手；AI Chat 支持多会话、上下文记忆、流式输出
- **多维度任务管理**：今日看板、任务模板、定时任务、数据统计、工作笔记
- **工具调用**：AI 可调网页搜索（含网页正文抓取）、本地文件读写、任务增删改查；敏感操作需确认
- **云端同步**：内置 Supabase 配置，也支持自定义 HTTP API / PostgREST 类接口
- **多模型接入**：OpenAI、DeepSeek、通义千问、智谱、Kimi、Groq、Ollama、LM Studio、G4F、自定义兼容接口
- **聊天记录导出**：支持导出为 Markdown，桌面端和 Android 端均可用
- **密码管理 & 工作笔记**：内置密码本、Markdown 笔记编辑器
- **i18n**：中文、English、日本語
- **深色模式**：全局深色主题支持

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | [SvelteKit](https://kit.svelte.dev/) |
| 桌面/移动容器 | [Tauri 2](https://v2.tauri.app/) (Rust) |
| 样式 | [Tailwind CSS](https://tailwindcss.com/) |
| 图标 | [Phosphor Icons](https://phosphoricons.com/) |
| 数据同步 | [Supabase](https://supabase.com/) / 自托管 PostgREST |
| AI 集成 | 直接调用各服务商 API，不经过中间服务器 |

## 快速开始

### 环境要求

- Node.js 16+ 或 bun v1.2.0+
- Rust 工具链（首次构建时自动安装）
- 平台开发依赖：
  - Windows：WebView2（Win10+ 默认自带）
  - macOS：Xcode Command Line Tools
  - Linux：WebKit2GTK（`webkit2gtk-4.0`）
  - Android：Android SDK + NDK（参考 [Tauri 移动端文档](https://v2.tauri.app/start/prerequisites/#android)）

### 安装与运行

> G4F 资源从仓库根目录 `g4f.dev/dist` 加载，版本固定 `0.2.7`。本地开发需要该目录存在。

```bash
git clone https://github.com/MakotoArai-CN/WorkPlan-with-AI.git
cd WorkPlan-with-AI
bun install
```

配置数据库（可选）：

- 方式一：`cp .env.example .env`，填写 Supabase URL / Key / 表名
- 方式二：启动应用后在 系统设置 → 数据库配置 中填写

建表 SQL：

```sql
CREATE TABLE IF NOT EXISTS planpro_data (
    id BIGSERIAL PRIMARY KEY,
    user_key TEXT UNIQUE NOT NULL,
    content JSONB,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_planpro_user_key ON planpro_data(user_key);
```

启动开发：

```bash
bun run tauri dev
```

构建生产版本：

```bash
bun run tauri build
```

> Windows 下如果项目路径包含中文等非 ASCII 字符，Android NDK 链接阶段可能失败，请将项目放到纯英文路径。

## 使用说明

### Access Key

首次使用需要输入 Access Key 用于云端数据隔离，可以输入任意字符串，也可以使用随机生成。建议设置得复杂一些。

### AI 配置

在 系统设置 → AI 配置 中选择服务商、填写 API Key 和模型即可。支持保存多个连接配置，每个连接分别保存服务商、模型、Base URL、API Key 和 G4F 提供商设置。

### 任务管理

- 今日看板：管理当天待办
- 任务模板：保存常用任务结构
- 定时任务：按周期自动生成任务
- 数据统计：可视化完成情况
- 工作笔记：Markdown 编辑，支持 AI 辅助总结、续写、提炼行动项

## 项目结构

```
WorkPlan-with-ai/
├── src/
│   ├── lib/
│   │   ├── components/       # Svelte 组件
│   │   ├── i18n/             # 国际化语言包 (zh/en/ja)
│   │   ├── stores/           # 状态管理
│   │   └── utils/            # 工具函数
│   ├── routes/               # SvelteKit 路由
│   ├── app.css
│   └── app.html
├── src-tauri/
│   ├── capabilities/         # Tauri 权限配置
│   ├── src/                  # Rust 后端
│   ├── Cargo.toml
│   └── tauri.conf.json
├── g4f.dev/                  # G4F 前端资源 (0.2.7)
├── .env.example
├── CHANGELOG.md
├── README.md
└── package.json
```

## 贡献

欢迎任何形式的贡献。

1. Fork 项目
2. 创建分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'Add xxx'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 提交 Pull Request

## 致谢

- [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) — 项目灵感来源
- [SvelteKit](https://kit.svelte.dev/) · [Tauri](https://tauri.app/) · [Supabase](https://supabase.com/) · [Tailwind CSS](https://tailwindcss.com/) · [Phosphor Icons](https://phosphoricons.com/)

## Todolist

- [ ] 继续扩展更多语言包与翻译质量
- [x] 修复移动端没有备份/恢复，切换账号，删库跑路的bug
- [x] 修复右键菜单点击粘贴后粘贴选项会立即消失，然后变成创建任务的bug
- [ ] 修复 Vditor 的快捷键气泡提示被遮挡的问题
- [x] AI 配置保存的 API Key 自动同步到密码本
- [x] 右键菜单优化，增加快捷键
- [x] 代码块快捷复制
- [x] 数据可视化表格
- [x] 移动端 UI 优化
- [x] AI 报告生成自定义提示词
- [x] AI 管理任务，增删改查
- [x] 移动设备适配
- [x] 账号保护功能
- [x] AI 任务总结、日/周报生成

## 许可证

[AGPL-3.0](LICENSE)

## 免责声明

本项目仅供个人学习和研究使用，不提供任何商业用途保证。用户需自行承担使用风险，并遵守各 AI 服务提供商的使用条款。
