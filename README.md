<div align="center">

<img src="./src-tauri/icons/icon.png" width=180 height=180>

# WorkPlan with AI

[![License](https://img.shields.io/badge/license-AGPL3.0-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.x-red?logo=tauri)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2.x-orange?logo=svelte)

</div>

## 这是什么

WorkPlan with AI 是一个本地优先的任务管理应用，使用 Tauri 2 + SvelteKit 开发，支持 Windows、macOS、Linux 和 Android。

它最初受 [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan) 启发，后来从 Web 应用重构成了 Tauri 桌面/移动端应用。现在包含任务看板、模板、定时任务、统计、工作笔记、工时记录和密码本，也可以接入大语言模型做任务生成、内容整理和查询。

项目是个人维护的，没有团队协作功能，也没有做很重的 UI 打磨。

> 当前版本是 0.3.12，1.0 还没发布。0.3.x 仍在快速迭代，升级前请先备份重要数据，不保证跨版本完全兼容。
>
> 0.2.7 相对稳定；0.3 之后加了不少新东西，旧功能也可能受影响。

## 功能

### 任务

- 今日看板：当天的待办和完成情况
- 任务模板：保存常用的任务结构
- 定时任务：按星期自动生成任务
- 数据统计：完成率、趋势和日报/周报
- 支持子任务、优先级、截止时间、备注和右键菜单

### 工时记录

- 加班和请假放在同一个入口，默认显示加班，可以切到请假
- 按年、月、日查看
- 加班记录开始/结束时间、类型、补偿方式和备注，跨天会自动计算
- 请假支持按天或按小时、半天、8 种类型、带薪/不带薪
- 根据月薪和计薪规则估算加班工资和年假余额
- 导出支持老板版（不含工资）、完整版和自定义字段，格式为 CSV / Excel / JSON

### 工作笔记

- Markdown 编辑器，支持 Vditor 和 Milkdown
- 多选、全选，批量导出 Word；单篇也可以导出 Markdown / HTML / Word / PDF
- 笔记可以标记为锁定，锁定后 AI 不可见
- 笔记云同步默认关闭，开启后压缩加密再上传

### 密码本

- 主密码解锁，支持 PIN、设备绑定和恢复码
- 密码条目本地加密保存
- 支持导入 1Password 导出的 CSV
- 支持从 Bitwarden 官方云或自部署 Vaultwarden 只读导入
- 密码库云同步默认关闭，开启后使用主密码 + 设备指纹派生的密钥二次加密

### AI

- 接入 OpenAI、DeepSeek、通义千问、智谱、Kimi、Groq、Ollama、LM Studio、Magpie、G4F 等服务商
- AI Chat 支持多会话、上下文、流式输出和 Markdown 渲染
- 可以查询和操作任务、模板、定时任务、工时记录和笔记
- 修改、删除等敏感操作会先弹应用内确认，用户拒绝就不执行
- AI 无法访问密码本；锁定笔记和标记为「AI 不可访问」的工时记录也不会提供给 AI
- 工时页有 AI 职业分析，可以按工作量、工资和城市生成评分、锐评、年度总结和鼓励

### 同步

- 任务数据默认使用内置 Supabase 配置，也可以换成自定义 HTTP API / PostgREST 接口
- 任务按 id 合并，离线新建的记录在恢复连接后会保留
- 笔记和密码库的云同步是单独开关，默认关闭
- 云端只保存密文，具体加密方式见设置页说明

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | SvelteKit 2、Svelte 5 |
| 桌面/移动容器 | Tauri 2（Rust） |
| 样式 | Tailwind CSS 4 |
| 图标 | Phosphor Icons |
| 数据同步 | Supabase / 自托管 PostgREST |
| AI | 直接请求各服务商 API，不经过中间服务器 |

## 本地运行

需要 Bun 1.2+、Rust 工具链，以及对应平台的 Tauri 依赖：

- Windows：WebView2（Win10/11 一般自带）
- macOS：Xcode Command Line Tools
- Linux：WebKit2GTK
- Android：Android SDK + NDK

G4F 资源从仓库根目录的 `g4f.dev/dist` 读取，版本固定为 1.1.2。这个目录不存在时，先运行 `./build-all.sh` 拉取。

```bash
git clone https://github.com/MakotoArai-CN/WorkPlan-with-AI.git
cd WorkPlan-with-AI
bun install
bun run tauri:dev
```

只跑前端：

```bash
bun run dev
```

构建：

```bash
bun run build
bun run tauri:build
```

Windows 下如果项目路径包含中文，Android NDK 链接可能失败，建议把项目放在纯英文路径。

## 数据库

任务同步默认使用一张 `planpro_data` 表。最简单的建表方式：

```sql
CREATE TABLE IF NOT EXISTS planpro_data (
    id BIGSERIAL PRIMARY KEY,
    user_key TEXT UNIQUE NOT NULL,
    content JSONB,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_planpro_user_key ON planpro_data(user_key);
```

完整的分表方案和本地 SQLite 方案放在 `docs/sql/`：

- `cloud_schema.sql`：PostgreSQL / Supabase，按实体分表，支持软删除和增量同步
- `local_schema.sql`：轻量 SQLite，只有 `meta`、`records`、`outbox` 和 FTS5 索引
- `README.md`：两份 schema 的说明

目前应用实际仍使用 localStorage 加单行 JSON 同步；`docs/sql` 里的分表方案是后续迁移目标，尚未接入运行时。

## 使用说明

### Access Key

第一次打开会要求填 Access Key，用来隔离云端数据。可以自己填，也可以随机生成。建议用长一点的字符串。

### AI 配置

在「系统设置 → AI 配置」里选服务商、填 API Key 和模型。可以保存多个连接配置，每个配置单独保存服务商、模型、Base URL 和 Key。

AI 请求直接发给你选择的服务商，不经过本项目的服务器。使用前请确认服务商的隐私政策。

### 导入密码

密码管理右上角菜单里有「导入」和「从 Bitwarden / Vaultwarden 导入」。

- 1Password：在 1Password 里导出 CSV，直接选文件导入
- Bitwarden / Vaultwarden：填服务器地址、邮箱和主密码。只支持 PBKDF2 账户，开启两步验证的账户暂不支持
- Vaultwarden 导入是只读的，不会修改远端数据

### 云同步

任务同步默认开启（使用 `.env` 里的 Supabase 配置时）。如果不希望上传，在设置里把数据库配置关掉，或填自己的地址。

笔记和密码库同步默认关闭，需要在「系统设置 → 安全云同步」里单独开启。开启后只上传加密后的数据，换设备或重装后可能无法解密，请保留本地备份。

## 项目结构

```text
WorkPlan-with-ai/
├── src/
│   ├── lib/
│   │   ├── components/       # Svelte 组件
│   │   ├── i18n/             # 中文 / English / 日本語
│   │   ├── stores/           # 状态和持久化
│   │   └── utils/            # 加密、导出、同步、AI 工具
│   ├── routes/
│   ├── app.css
│   └── app.html
├── src-tauri/
│   ├── capabilities/         # Tauri 权限
│   ├── src/                  # Rust 后端
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/sql/                 # 云库和本地库 SQL
├── g4f.dev/                  # G4F 前端资源
├── CHANGELOG.md
└── package.json
```

## 测试

```bash
bun test                 # 前端/工具函数测试
bun run check            # svelte-check
bun run build            # 生产构建
cd src-tauri && cargo test --lib
```

## 已知限制

- 1Password 只支持 CSV 导入，不接入官方 API 或浏览器扩展
- Vaultwarden 导入只支持 PBKDF2，暂不支持 Argon2 和两步验证
- 笔记/密码云同步是设备绑定的，换设备或清空本地密钥后旧云端数据无法解密
- 本地 SQLite 目前只有 schema，没有替换 localStorage
- Android 端使用 HTTP 连接 Vaultwarden 时可能受系统 cleartext 策略限制，建议用 HTTPS

## 贡献

有问题可以直接开 issue。提交代码前请先跑一遍 `bun test`、`bun run check` 和 `bun run build`。

## 致谢

- [AsheQSQ/WorkPlan](https://github.com/AsheQSQ/WorkPlan)：项目起点
- [SvelteKit](https://kit.svelte.dev/)、[Tauri](https://tauri.app/)、[Supabase](https://supabase.com/)、[Tailwind CSS](https://tailwindcss.com/)、[Phosphor Icons](https://phosphoricons.com/)
- [Linux.do](https://linux.do/)

## 许可证

[AGPL-3.0](LICENSE)

## 免责声明

本项目仅供个人学习使用，不保证商业可用性。使用 AI 服务时请遵守对应服务商的条款，重要数据请自行备份。
