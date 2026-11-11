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
> 1.0.0 正式版还没有发布，项目还在快速迭代升级中，不保证版本升级后的兼容性，版本升级前注意备份重要数据。
> 在V0.2.7版本为相对稳定的版本，0.3.*开始，由于开始新的探索，可能存在一些bug（包括原有功能）。

### 主要功能

- **AI 助手 + AI Chat**：任务看板、模板、定时任务、统计、笔记均可唤起右侧 AI 助手；AI Chat 支持多会话、上下文记忆、流式输出
- **多维度任务管理**：今日看板、任务模板、定时任务、数据统计、工作笔记
- **工具调用**：AI 可调网页搜索（含网页正文抓取）、本地文件读写、任务增删改查；敏感操作需确认
- **云端同步**：内置 Supabase 配置，也支持自定义 HTTP API / PostgREST 类接口；笔记、密码库、工时记录支持主密码派生的跨设备加密同步（任务本身不加密）
- **多模型接入**：OpenAI、DeepSeek、通义千问、智谱、Kimi、Groq、Ollama、LM Studio、自定义兼容接口
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
  - Linux：WebKit2GTK 4.1（`webkit2gtk-4.1`）
  - Android：Android SDK + NDK（参考 [Tauri 移动端文档](https://v2.tauri.app/start/prerequisites/#android)）

### 安装与运行

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

**安全必需步骤：** 在项目 SQL Editor 中执行 [`docs/sql/rls_security.sql`](docs/sql/rls_security.sql) 启用 RLS，再执行 [`docs/sql/verify_rls.sql`](docs/sql/verify_rls.sql) 验证账号隔离。仅建表或客户端过滤不会保护公开表；客户端只填写 publishable / anon 公钥，禁止 service_role / secret 管理密钥。已出现公开表告警时请按 [`docs/SUPABASE_SECURITY.md`](docs/SUPABASE_SECURITY.md) 处理潜在泄露与密钥轮换。

启动开发：

```bash
bun run tauri dev
```

构建生产版本：

```bash
bun run tauri build
```

> Windows 下如果项目路径包含中文等非 ASCII 字符，Android NDK 链接阶段可能失败，请将项目放到纯英文路径。

### Arch Linux

AppImage 内置了 Ubuntu 构建环境的 GTK/WebKit 运行库，在 Arch 上可能因系统库版本冲突直接崩溃。每次正式发布会自动构建并验证 Arch x86_64 安装包，优先下载 Release 中的 `.pkg.tar.zst`：

```bash
# 将 VERSION 替换为下载的版本号
sudo pacman -U ./workplan-bin-VERSION-1-x86_64.pkg.tar.zst
```

不需要系统安装时，可使用不打包运行库的原生便携版：

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator
tar -xzf WorkPlan_VERSION_linux-x86_64.tar.gz
./WorkPlan-linux-x86_64/workplan
```

需要自行重建时，下载同版本 `.src.tar.gz`（含固定校验和的 PKGBUILD / .SRCINFO），以普通用户执行：

```bash
tar -xzf workplan-bin-VERSION-1.src.tar.gz
cd workplan-bin
makepkg -si
```

`pacman` 会管理依赖、桌面入口和图标；不要以 root 执行 `makepkg`。下载后可用同一 Release 的 `SHA256SUMS` 校验文件完整性。当前只提供 x86_64 Arch 包，Arch 衍生发行版需要兼容的运行库。[打包和验证流程](packaging/arch/README.md)。

#### 字体发虚

Arch 最小安装通常没有中文字体，WebKitGTK 会落到 fontconfig 的默认字体上，小字号中文就会出现发虚、发灰。安装后重启应用即可：

```bash
sudo pacman -S noto-fonts noto-fonts-cjk
```

应用本身已把字体栈改成跨平台的 `Inter / Noto Sans / Noto Sans CJK SC / Source Han Sans / WenQuanYi Micro Hei …`，并显式使用 subpixel 抗锯齿，不再强制灰度渲染。

如果只在 **非整数缩放**（125%、150%）下发虚，那是 WebKitGTK 对分数缩放的限制，可以改成整数缩放：

```bash
# GNOME
gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer']"
# 或者临时按 2x 渲染，再按 0.5 缩回
GDK_SCALE=2 GDK_DPI_SCALE=0.5 ./WorkPlan-linux-x86_64/workplan
```

#### 能力检测失败

AI 聊天的「检测能力」现在会保留每一项失败原因（悬停能力标签即可看到）。Linux 上常见原因：

- 没有配置模型或 API Key：`toolCall` / `nativeToolCall` 会失败
- 服务商不接受 `tool_choice` 强制工具调用：`nativeToolCall` 失败，但内置工具路由仍可用
- 网络或证书问题：`webSearch` 失败，错误会标成 `network`
- 命令缺失：标成 `unsupported`

工作区根目录在 Linux 上按「文档目录 → 应用数据目录 → `$HOME/WorkPlan`」回退，不再因为缺少 XDG 用户目录而落到进程 CWD。


### Access Key

首次使用需要输入 Access Key 用于云端数据隔离，可以输入任意字符串，也可以使用随机生成。建议设置得复杂一些。

### AI 配置

在 AI 配置中选择服务商、填写 API Key 和模型即可。支持保存多个连接配置，每个连接分别保存服务商、模型、Base URL 和 API Key。

普通 AI 对话只发送当前消息及主动附加的文件，不默认分析任务、笔记或工时数据。
需要处理应用内数据时请明确说明，例如“查看我的任务”或“总结这篇笔记”；相关修改仍需确认。
附件按当前提供商、模型及 API 格式校验：最多8个，单个媒体不超过5MB；未知多模态模型按仅文本处理。
不支持的 PDF、Office 文档、压缩包或音视频需先提取/转录为文本，不会假装读取成功。
数据清除入口统一位于系统设置，操作不可撤销，请先备份并仔细确认当前账号。

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
├── .env.example
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
- [SvelteKit](https://kit.svelte.dev/) · [Tauri](https://tauri.app/) · [Supabase](https://supabase.com/) · [Tailwind CSS](https://tailwindcss.com/) · [Phosphor Icons](https://phosphoricons.com/) ·[Linux.do](https://linux.do/)

## Todolist

- [x] 继续扩展更多语言包与翻译质量
- [x] 修复移动端没有备份/恢复，切换账号，删库跑路的bug
- [x] 修复右键菜单点击粘贴后粘贴选项会立即消失，然后变成创建任务的bug
- [x] 修复 Vditor 的快捷键气泡提示被遮挡的问题
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
