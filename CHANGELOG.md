# Changelog

## [0.3.14] - 2026-10-28

- 修复主题切换时外观高亮块被全局主题过渡覆盖、瞬间跳到目标位置的问题；高亮块现在独立使用 480ms 的 `ease-in-out` 位移动画
- 主题整体颜色过渡从 240ms 放慢到 480ms，并在切换主题变量前先注册过渡，减少生硬的一帧闪变
- 语言高亮块也改为相同的 480ms 缓动，切换语言时不再瞬移

## [0.3.13] - 2026-10-28

- 打开密码管理时，主密码输入框自动获得焦点，输入后可直接按回车解锁
- 「从 Bitwarden / Vaultwarden 导入」从密码页菜单移到系统设置，只有开启密码库云同步后才显示入口，避免未启用同步时误导入
- 删除自定义 AI 连接时同步清理 `providerConfigs` 中不再被任何连接使用的 API Key，修改连接时仍按原逻辑覆盖缓存
- 外观主题和语言选项改为和左侧菜单一致的滑动背景块，切换时背景色块以 300ms 缓动移动
- 把主题初始化脚本从 `app.html` 内联代码移到 `static/theme-init.js`，解决 Tauri CSP 对内联脚本的拦截；开发环境单独放行 Vite HMR 所需的 inline/eval 和 blob worker，生产 CSP 仍保持严格
- 更新依赖锁文件中的可兼容版本，包含 docx、Svelte、PostCSS、Autoprefixer 及一批传递依赖
- 保持 0.3.11 的 localStorage 数据格式兼容，未修改数据库 schema；旧的 task cache 缺少 `overtimeRecords`/`leaveRecords` 时仍按空数组加载

## [0.3.12] - 2026-10-27

- 重写 README 和 `docs/sql/README.md`，去掉营销化描述，修正过期功能和命令，补全 Bitwarden/Vaultwarden、1Password、云同步和本地 SQLite 的当前状态
- 密码库新增 **Bitwarden / Vaultwarden 只读导入**：Bitwarden 官方云与自部署 Vaultwarden 共用同一套预登录/令牌/`/api/sync` 流程，PBKDF2 + HKDF-Expand + AES-CBC/HMAC 解密后写入本地密码库；主密码只用于本次导入，不保存
- Bitwarden / Vaultwarden 导入支持文件夹分类、用户名、密码、URL、备注和 TOTP；Argon2 账户会提示先改为 PBKDF2，开启两步验证的账户会明确提示暂不支持，组织密钥无法解密时跳过对应条目
- 左侧导航改为滑动高亮块：切换菜单时背景色块以 300ms 缓动移动到目标项，折叠态同样生效
- 移除 Webhook / WebSocket AI 供应商与系统设置中的连接器配置；旧 `webhook`/`openclaw` 配置自动迁移为普通 OpenAI 兼容自定义接口，不再建立 WebSocket
- 收紧 AI 数据权限：AI 工具无法访问密码库；锁定笔记继续对 AI 不可见；加班/请假记录新增「AI 不可访问」标记，标记后 AI 无法读取、修改或删除，且不会出现在 AI 列表中
- 取消 AI 设置自动把 API Key 写入密码库的旧行为，避免 AI 子系统触碰密码本
- 密码 CSV 导入兼容 1Password 导出的 `Title,Url,Username,Password,Notes` 格式及 UTF-8 BOM，并支持引号内的逗号/换行备注；可直接导入 1Password CSV
- 修复安全云同步设置开关引用未定义翻译函数、点击后报 `t is not defined` 导致无法开启笔记/密码同步的问题
- 删除「AI 设置自动把 API Key 保存到密码库」的残留开关，避免界面出现已失效的密码库写入选项
- 新增默认关闭的**笔记云同步**与**密码库云同步**：笔记先 gzip 压缩再 AES-256-GCM 加密，密码库用「主密码 + 设备指纹」派生的密钥二次加密；云端只保存密文，锁定笔记默认不上传，可在设置中单独允许
- 云同步设置新增开关、立即同步、状态与失败提示；设备密钥变化/换设备导致无法解密时停止同步并提示，不会覆盖云端数据
- 工时页新增 **AI 职业分析**：可结合加班、请假、任务、月薪和城市生成 0-100 职业评分、四维评分、锐评、年度总结和鼓励；支持三种模式与复制结果
- AI 原生工具新增 `workplan_worklog_action` 和 `workplan_notes_action`：可查询/新增加班、请假、笔记，修改和删除必须经过应用层确认弹窗，用户拒绝时不会执行；锁定笔记对 AI 不可见
- 新增云数据库 SQL 设计：`docs/sql/cloud_schema.sql`（PostgreSQL/Supabase，按实体分表、软删除、加密笔记/密码密文、索引与 RLS 示例）和轻量本地库 `docs/sql/local_schema.sql`（SQLite：`meta` + 通用 `records` + `outbox` + FTS5，不按实体拆表）
- 加班与请假合并为单一「工时记录」入口：默认显示加班，可切换到请假；新增按钮按当前页签创建对应记录
- 请假记录支持开始/结束日期、按天或按小时请假、半天及小数时长、8 种请假类型（年假/病假/事假/调休/产假/婚假/丧假/其他）、带薪/不带薪和备注
- 支持修改和删除请假记录；跨月请假会按实际重叠天数分摊到各月，年/月/日视图均可查看
- 新增年假额度配置，自动计算年假已用/剩余、当月请假、年度累计与带薪/不带薪拆分
- 工时记录导出支持**按需字段**：老板版（只含日期/类型/时长/事项，不含工资）、完整版、自定义勾选；格式支持 CSV / Excel / JSON，范围可选本年或全部
- 工作笔记新增多选、全选/取消全选，支持把选中笔记批量导出为 Word（.docx），单篇笔记也可导出 Word
- `leaveRecords` 并入现有任务数据层：本地缓存、云端按 id 合并、导入/导出、清空数据均包含请假记录；旧数据缺少该字段时按空列表兼容
- 新增独立的「加班记录」模块：默认关闭，在 系统设置 → 效率工具 中启用后，桌面侧边栏和移动端「更多」会出现入口
- 支持按年 / 月 / 日切换查看，录入加班日期、开始/结束时间、加班类型（工作日/周末/节假日）、补偿方式（加班费/调休/无）和备注；结束时间早于开始时间按跨天计算
- 支持修改和删除记录；修改起止时间后工时、加班工资、月度汇总和年度汇总会实时重算
- 新增月薪与计算规则配置：按「月薪 ÷ 月计薪天数 ÷ 每日工时」折算时薪，支持调整计薪天数、每日工时和三类加班倍率
- 自动汇总上月实际加班工时与工资，并以「上月工时 × 当前时薪 × 上月类型加权倍率」估算本月预计加班工资；上月无记录时按本月已录工时推算，月薪变化立即重算
- 加班数据并入现有任务同步：本地缓存、云端按 id 合并、导入/导出、清空数据都会包含 `overtimeRecords`；旧数据/旧云端记录缺少该字段时自动按空列表兼容
- 新增 `overtime.js` 计算模块和 21 个加班/请假回归测试；补齐 zh/en/ja 文案

- 修复统计页生成日报/周报后复制按钮不显示「复制」：补全 `statistics_page.copy` 及 `common.send/added/expand/collapse` 的 zh/en/ja 文案，并新增 i18n key 校验测试，避免同类缺键再次上线
- 复制报告改用统一的剪贴板工具：`navigator.clipboard` 不可用或被拒绝时回退到 `execCommand`，复制成功/失败改为 toast 提示，不再弹出阻塞弹窗
- 修复任务生成偶发被网页搜索接管：网页搜索路由器在模型明确返回 `mode=reply` 时不再回退成搜索；收紧「最新/今日/资料/看一下」等易误判关键词；任务生成/规划类请求优先走任务路由；原生工具调用会忽略误选的 `workplan_web_search`；同时补充意图路由回归测试
- G4F 资源升级到上游 `gpt4free/g4f.dev` 固定提交 `f0f09e3`（1.1.2）：新增 Qwen、G4F Community、Ollama Swarm、CrowLLM、Eaon、OrcaRouter、RelayRouter、LLM7、Kilo、WebGPU/Bonsai/Chrome AI 本地模型等提供商，更新默认模型与服务端默认模型，并兼容旧 provider id（如 `g4f-api.airforce`）与旧 API Key 存储键；已下线的 Azure 连接自动回落到 G4F Auto
- 新增 `bunfig.toml` 把 vendored `g4f.dev` 自带的浏览器 smoke test 排除出 `bun test`，避免根目录测试被上游用例污染
- 依赖升级：Vite 8.3.5、Svelte 5.57.2、DOMpurify 3.4.17、KaTeX 0.18.11、Mermaid 11.17.2、Supabase JS 2.118.0、Milkdown 7.22.3、Chart.js 4.6.1 等；新增 `devalue`、`prosemirror-view`、`source-map-js`、`fflate`、`brace-expansion` 安全覆盖，`bun audit` 从 27 条（含 1 条 critical）降到 2 条 low（仅 SvelteKit 3 可修）
- 修复离线创建的任务在恢复连接后消失：任务数据新增按账号隔离的本地缓存，云端拉取从「整份覆盖」改为按 id 合并，离线新建/修改/删除会保留并重新上传，其他设备的新任务也不会被本地覆盖；心跳同步同样先合并再推送，存储配额不足时退化为只缓存当前数据（新增 `task-sync.js` 与合并回归测试）
- 修复定时任务自动生成一直不生效：`checkScheduled` 的嵌套 store `update` 会用旧状态覆盖新任务，且 `lastGeneratedDate` 未持久化；改为单次 updater 返回新状态并保存，补生成上限 90 天，修正周日 0/7 不一致
- 统一本地日期时间：`today`、统计今日/本周区间、逾期判断、完成/开始时间不再用 UTC `toISOString()`，避免 UTC+8 凌晨「今天」变昨天、逾期和完成时间偏移；`today` 跨午夜自动滚动，统计/看板/详情共用新增的 `datetime.js`
- 修复工作笔记切换或离开页面时丢失未保存内容：销毁编辑器前先落盘并取消旧计时器，自动保存只写回发起编辑的笔记；存储配额失败不再连带丢掉内存中的笔记，导入校验并去重 id
- 修复密码库安全与解锁问题：移动端生物识别解锁引用未定义变量导致崩溃；清空密码库时同时清除 PIN/生物识别/设备绑定；恢复码恢复后重新启用绑定标志；PIN 锁定计数正确返回 `locked_out`；启用生物识别不再消耗 PIN 尝试次数；主密码修改遇到无法解密的条目会整体中止而不是写入空密文；设备绑定改为条目写盘成功后再置位
- 修复统计页任务详情编辑/删除/备注无效果，以及移动端模板/定时任务详情误操作任务 store
- 修复 AI 聊天取消后仍发起不可取消请求、切换会话期间流式响应写错会话；聊天历史持久化剥离 base64 并增加配额兜底；AI 设置点取消不再保存修改；webhook 自定义端点不再被清空；Enter 发送增加输入法组合保护
- 修复代码块复制按钮每次更新都会重复包裹 `<pre>`/新增按钮；复制失败回退；CSV 导出增加公式注入防护与表头并集
- Vditor 图标脚本改为同源预加载，消除 CSP 对内联脚本的拦截；Windows 下载文件名拒绝 NUL/CON/COM1 等设备名
- 修复 Windows 自启动路径含空格时未加引号导致开机不启动，启动项指向旧安装路径时状态错误地显示为已启用；Linux `.desktop` 的 Exec 与 macOS plist 路径补充转义
- SSRF 防护补充 IPv4-compatible `::/96`、site-local `fec0::/10`、NAT64 `64:ff9b::/96` 与 6to4 内嵌私网地址的拦截
- 文件工具授权边界移到后端：`trustedDirs` 参数不再被接受，改为 `set_trusted_directories` 维护后端白名单；工作目录从进程 CWD 改为稳定的「文档/WorkPlan」（移动端为应用数据目录），避免开机自启时以 `System32` 为根
- 文件搜索/读写/删除命令改为 async，避免大目录扫描阻塞 UI 线程；`fetch_web_content` 手动跟随重定向，每一跳都重新校验并固定 DNS，关闭跨主机重定向的 DNS-rebinding 窗口
- Android JS Bridge 的 `content://` 读写删除先校验应用持有的 URI 授权，模型生成的工具调用不能再借用应用存储权限访问任意文件
- 修复 oklch 导出为空操作：导出前按 oklab→sRGB 公式把 Tailwind v4 的 `oklch()` 颜色转换成 `rgb()/rgba()`，PDF/截图不再出现黑块或透明色
- 按 2026-10 官方文档/在线模型目录更新预置模型：OpenAI、DeepSeek、Groq、智谱、通义千问、Kimi、小米 MiMo、Claude、Gemini、Mistral、OpenRouter、Together、Fireworks、Cohere、Perplexity、MiniMax、StepFun、Novita；新增 xAI Grok 提供商
- 新增 Magpie 本地网关预设（`http://127.0.0.1:3425/v1`，默认 `auto/minimax-m3.1-flash`），支持从网关 `/v1/models` 拉取 `auto/*` 模型列表
- 跟进厂商 API 变更：Anthropic 启用 `/v1/models`（`x-api-key` + `anthropic-version`）；Cohere 改用 v2 `/chat`；Perplexity 改用 Agent `/v1/agent`（原 Sonar Chat Completions 于 2026-09-27 下线）；MiniMax 改用 `api.minimax.cn` OpenAI 兼容端点；无法从官方来源核实的厂商保留原列表
- 版本号提升到 `0.3.12`

## [0.3.9] - 2026-05-06

- 修复工作笔记编辑器生命周期问题：切换默认编辑器、关闭笔记或保存前会同步当前内容并销毁旧编辑器实例，避免发布版设置页卡住、输入框抖动和刷新按钮闪烁
- 修复默认编辑器无法打开笔记、Vditor / Milkdown 切换后残留旧实例导致其他功能不可用的问题
- 修复 Vditor 在发布版 WebView 中正文区可能无法获得焦点或无法编辑的问题：运行时资源改为本地打包，不再依赖 `unpkg`，并稳定编辑器高度、点击命中和 `contenteditable` 状态
- Milkdown 编辑器新增内置工具栏，支持标题、加粗、斜体、行内代码、链接、列表、引用、代码块、分割线、撤销和重做
- 优化 Milkdown / ProseMirror 空白字符样式，减少编辑器运行时警告并保持 Markdown 排版显示稳定
- 调整测试通知交互：发送系统测试通知成功后不再额外弹出应用内通知

## [0.3.7] - 2026-05-01

- 这次真的修复了安卓端的问题了
- （可能）支持 function call
- 统一项目版本，由根目录VERSION控制，编译时自动更新版本号

## [0.3.6] - 2026-04-29

- 版本号同步到 `0.3.6`，覆盖前端包、Tauri 配置、Rust package 与相关锁文件
- AI Chat 新增 OpenClaw Gateway 提供商：系统设置启用后可在 AI 设置中选择 OpenClaw，并通过 Gateway WebSocket `chat.send` / `chat` 事件直接对接 OpenClaw
- 重构 OpenClaw 配置入口：保留 Gateway 地址、Token、会话 Key、超时与连接测试，移除旧 webhook / Telegram 桥接式配置
- Web demo 新增独立 `build:web` 输出，纯 Web 版隐藏本地文件、系统通知、OpenClaw 等不支持入口，并移除顶部预览提示
- AI Chat 增强附件与媒体能力：支持附加文件、图片、音频等上下文，展示附件预览，并支持保存生成的图片 / 音频
- 新增 AI 多步骤执行计划与后台执行完成 / 失败通知开关，便于跟踪长任务执行状态
- 优化 AI Chat 移动端高度、安全区、会话头像与消息展示，减少移动端布局遮挡和操作冲突

## [0.3.5] - 2026-04-20

- 修复 Android targetSdk 36 下返回键完全失效：MainActivity 改用 `OnBackPressedDispatcher`，并补齐 `mobile-onbackpressed-listener` 能力权限
- 修复 Android「选择受信任目录」点击无反应：`plugin-dialog` 的 `directory: true` 不支持移动端，改为提示手动粘贴路径
- 修复 Android 通知非重要通知：补齐 `notification:allow-create-channel` / `notification:allow-list-channels` 权限，高重要性通道创建成功
- 修复 Windows 通知只进通知中心不弹横幅：`sendNotification` 改走 Rust `notify-rust`（`plugin:notification|notify`），经 AUMID 触发 WinRT toast
- AI 配置自动拉取模型列表：baseUrl + apiKey 填好后 500ms 自动 GET `/models`，成功则自动填第一个；自定义接口也支持，失败静默
- AI 模型字段改为 `input + datalist`：既能下拉选已拉取的模型，也能自由输入用户自定义或接口未返回的模型名
- 移除 `sound: 'default'` 无效参数，减少跨平台噪音
- 桌面能力文件拆分：`capabilities/mobile.json` 专放移动端专属权限并用 `platforms` 限制，避免桌面构建解析失败

## [0.3.4] - 2026-04-18

- 石墨夜色主题全新设计，采用 iOS 液态玻璃风格：半透明毛玻璃面板、蓝紫色渐变背景、柔和光影层次，与深色模式明显区分
- AI Chat 停止按钮修复：工具路由阶段（意图分类、消息解析等）也可中断，不再仅限流式输出阶段
- AI Chat 重试修复：点击重试后，下方后续消息正确移除，不再与新回复同时显示
- AI Chat 取消操作优化：取消任务创建等操作后，AI 消息改为显示"操作已取消"而非直接消失
- AI Chat 撤回操作增加确认对话框，避免误操作删除消息
- 密码修改对话框支持 Enter 键提交，新增返回按钮（等效 ESC 键关闭）
- 工作笔记新增 AI 读写锁定功能，可标记笔记禁止 AI 访问，防止 AI 接口绕过提示词直接操作笔记
- 修复 PC 端"跟随系统"主题不生效问题，增加定时轮询检测系统主题变化（兼容 Tauri WebView）
- 修复 Android 返回键被拦截后无反应，补齐 `setupAndroidBackHandler` 注册调用
- 移动端 AI 助手面板去掉重复的返回按钮，避免与外层 header 冲突
- Android 通知改为重要通知（High importance），增加 `sound: 'default'` 参数确保前台弹出
- Android 受信任目录新增"浏览"按钮，使用 Tauri Dialog 插件调用系统目录选择器

## [0.3.3] - 2026-04-18

- AI Chat 新增停止按钮，支持中断 AI 流式输出，已生成的内容自动保留
- AI Chat 用户发送的消息支持 Markdown 渲染（链接、代码块、列表等）
- 自定义 AI 服务商显示 API Key 输入框并标注为可选，优化自建服务配置体验
- AI 流式请求支持 AbortController 信号传递，中断后优雅回退并保留部分内容
- 修复 Android 返回键重复触发问题，增加 300ms 防抖并同时注册 DOM 与插件监听
- 全局修复按钮鼠标样式：可点击元素显示手型光标，禁用元素显示禁止光标

## [0.3.2] - 2026-04-17

- AI Chat 新增用户消息操作：复制、编辑重发、撤回（删除该条消息及其 AI 回复）
- AI Chat 新增 AI 回复重试按钮，普通回复也可以重新生成
- AI Chat 新增聊天记录导出为 Markdown 功能
- AI Chat 工具调用时新增实时进度日志，显示当前正在执行的步骤（分析意图、搜索网页、读取文件、生成回复等）
- AI Chat 对话上下文增强：搜索结果、任务卡片、文件操作等非纯文本消息也会传递给 AI，解决多轮对话中 AI 丢失上下文的问题
- 新增网页内容抓取能力，Web 搜索后自动获取前 3 个结果的网页正文供 AI 总结
- 意图识别增加 AI 兜底分类，关键词未命中时由 AI 判断是否需要调用工具
- 导出功能 Android 兼容：所有文本导出改为通过 Rust 后端写入下载目录，不再依赖 WebView 的 `<a download>`
- 新增 `save_file_to_downloads` Tauri 命令，桌面端写入 `~/Downloads/`，Android 端写入应用外部文件目录
- `get_workspace_root` 适配 Android，移动端返回应用数据目录
- 全局深色模式适配 AI Chat 所有组件
- 导出、复制、文件操作等关键操作补齐 Toast 反馈提示
- 更新用户协议与隐私政策

## [0.3.1] - 2026-04-17

- 修复工作笔记 `Vditor` 图片上传插入逻辑，避免返回原始字符串导致的插入异常
- 调整 `Vditor` 浮层、提示和面板层级，修复部分场景下的遮挡与不可见问题
- 清理 `svelte-check` 警告，当前项目检查结果为 `0 errors, 0 warnings`
- 收紧 Markdown 渲染安全策略：Mermaid 改为更严格模式，禁用危险 HTML 标签能力，并在渲染后再次清洗 SVG
- 收紧外部链接打开逻辑，仅允许 `http/https` 协议并启用 `noopener,noreferrer`
- 为 AI 请求地址和 Markdown 链接增加协议白名单校验，阻止 `javascript:`、`file:` 等非 HTTP(S) 地址
- 将 Tauri `csp` 从 `null` 收紧为可运行的最小允许集，默认拒绝远程脚本、对象与嵌入框架
- 移除未使用的 Shell 执行权限与插件接入，降低越权调用面
- 锁定 Rust 侧 `tauri` minor 版本，避免 Android 构建时出现 `2.10.x / 2.9.x` 版本漂移

## [0.3.0] - 2026-04-17

- 新增统一的右侧 AI 助手工作流，覆盖任务看板、任务模板、定时任务、数据统计和工作笔记，并为不同模块提供定制预设提示
- AI Chat 升级为标准会话模式，补齐历史记录、多会话管理、自动滚动到底部和更完整的项目能力调用入口
- 新增本地文件工具与网页搜索能力，支持文件扫描、读取、检索；写入和删除仅允许工作目录及用户授权目录，并支持敏感操作确认
- 数据库配置升级为“内置配置 + 自定义配置”双模式，新增数据库服务目录、容量说明和自托管建表说明
- 恢复 G4F 根目录 `g4f.dev/dist` 接入，资源升级到 0.2.7，并修正 GitHub Release 工作流对 G4F 资源的拉取与校验逻辑
- 优化桌面端布局交互，新增左侧导航折叠、右侧面板按需展开、更多主题配色，以及工作笔记编辑器 / Milkdown / 深色代码块显示改进
- 修复右侧 AI 助手唤起、菜单切换影响 AI 面板、分类下拉样式不一致等一批交互问题

## [0.2.7] -2026-04-16

- 重新接入 G4F，改为从根目录 `g4f.dev/dist` 加载
- 新增i18n支持
- 优化加密算法
- 新增主题切换支持

## [0.2.6] -2025-12-27

- 引入`@kingsword/tauri-plugin-mobile-onbackpressed-listener`修复移动端返回事件
- 修复工作笔记编辑时，按下`Tab`会切换焦点到另一个控件上，不是打出制表符的bug
- 优化启动画面
- 新增密码修改功能

## [0.2.5] -2025-12-25

- 修复启动过度动画问题
- 修复移动端的返回事件（测试中）
- 修复部分测试出来的bug

## [0.2.4] -2025-12-23

- 新增AI 修改任务的子步骤增删改查的能力
- 修复密码管理的记住会话状态无效问题
- 新增AI Chat 代码块快捷复制功能
- 新增全局右键菜单(PC)
- 新增加载动画
- 移动端返回按钮优化（未经严谨测试）
- 修复自定义接口API Key强制填写的，本地部署接口地址无法自定义的bug
- 优化工作笔记Markdown编辑器
- 工作笔记接入AI功能

## [0.2.3] -2025-12-18

- 修复 自定义API 报错问题，将保存的API数据独立保存
- 新增小米mimo支持

## [0.2.3] -2025-12-17

- 修复大量已知问题
- 新增 工作笔记，密码管理功能
- 优化移动端逻辑
- AI Chat 新增Markdown语法支持

## [0.2.2] -2025-12-16

- 修复Github Actions 自动部署后Android没有签名的问题
- 修复AI Chat 页面的部分问题
- 修复AI助手的部分预设问题

## [0.2.1] -2025-12-15

- 修复移动端 AI Chat , 系统设置 页面的适配问题
- 新增AI 报告生成自定义提示词
- 添加AI管理任务功能，增删改查任务，支持多任务创建，修改，增加，删除，查看任务详情等

## [0.2.0] -2025-12-14

- Added AI Chat, System Settings
- Added Free API Interface G4F
- Added Mobile Adaptation
- 为账号新增保护功能
- 新增任务总结，日/周报生成

## [0.1.0] -2025-12-13

- Initial release
