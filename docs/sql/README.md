# 数据库设计

这里放两份 SQL，一份用于云端，一份用于本地。两份都还没有接入运行时：应用现在仍然用 localStorage 和单行 JSON 同步，这些文件是后续迁移的目标。

## 云端：`cloud_schema.sql`

适用于 PostgreSQL 14+ 和 Supabase。

按数据类型分表：

- `workplan_tasks`：任务
- `workplan_templates`：任务模板
- `workplan_scheduled_tasks`：定时任务
- `workplan_overtime_records`：加班记录
- `workplan_leave_records`：请假记录
- `workplan_notes`：笔记，只存密文
- `workplan_vault_meta` / `workplan_vault_items`：密码库的 KDF 参数和密文条目
- `workplan_sync_state`：同步版本号
- `planpro_data`：旧的单行 JSON 表，保留用于回滚，不会自动删除

每张同步表都有 `(user_key, id)` 主键、`updated_at` 和可空的 `deleted_at`。删除使用软删除，方便离线客户端合并。同步拉取走 `(user_key, updated_at)` 索引，工时和请假另有日期索引。

在 Supabase SQL Editor 里执行一次即可。如果这些表通过 anon key 暴露，记得启用文件末尾的 RLS 示例；示例按 JWT 里的 `workplan_key` 字段判断归属。

## 本地：`local_schema.sql`

SQLite 3.35+，刻意做得很轻：

- `meta`：schema 版本、同步游标、少量设置
- `records`：所有实体共用一张表，`payload` 存 JSON；锁定笔记和密码条目存密文
- `outbox`：本地改了但还没推送到云端的记录
- `note_fts`：可选，只索引已解锁笔记的全文

不为每种实体单独建表，加字段时只改 JSON，不需要迁移表结构。索引只有 `(collection, updated_at)` 和 `(collection, sort_key)` 两组。锁定笔记和密码不会进入 FTS。

应用现在的数据仍在 localStorage，这份 schema 是 SQLite 迁移用的，不是当前运行状态。

## 迁移顺序

1. 先建云端的表，旧的 `planpro_data` 不动。
2. 本地建 SQLite 表，把 localStorage 里的数据按实体写入 `records`。
3. 双写一段时间，确认新表数据正确后再切读。
4. 出问题时可以退回 `planpro_data` 和 localStorage。

目前只完成了第 1、2 步的 schema 设计，运行时迁移还没开始。
