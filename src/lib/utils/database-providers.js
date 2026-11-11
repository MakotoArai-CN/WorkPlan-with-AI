export const DATABASE_SETUP_SQL = `-- WorkPlan Supabase RLS hardening. Execute as the project database owner in
-- SQL Editor, NOT with the public client key. Safe to rerun; no rows deleted.
-- The legacy planpro_data table is covered even without cloud_schema.sql.
-- Custom table names require a reviewed explicit addition to the allowlist.
--
-- Identity is a bearer capability, NOT Supabase Auth: the client supplies the
-- complete record key in x-workplan-key. Anyone knowing a key can impersonate
-- it. If rows/keys were public, first contain exposure, then rotate compromised
-- account secrets with a backed-up migration. RLS cannot undo a prior leak.

begin;

CREATE TABLE IF NOT EXISTS public.planpro_data (
    id BIGSERIAL PRIMARY KEY,
    user_key TEXT UNIQUE NOT NULL,
    content JSONB,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_planpro_user_key ON public.planpro_data(user_key);

create or replace function public.workplan_request_key()
returns text
language sql
stable
security invoker
set search_path = pg_catalog
as $$
    select case
        when length(key) between 1 and 512 and key !~ '[[:cntrl:]]'
        then key
        else null
    end
    from (
        select nullif(btrim(
            nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-workplan-key'
        ), '') as key
    ) request_key;
$$;

comment on function public.workplan_request_key() is
    'Untrusted request bearer secret, not authenticated user identity. A leaked key must be rotated.';
revoke all on function public.workplan_request_key() from public;
grant execute on function public.workplan_request_key() to anon, authenticated;

do $$
declare
    target_table text;
    policy_row record;
    sequence_name text;
    workplan_tables text[] := array[
        'planpro_data',
        'workplan_accounts',
        'workplan_sync_state',
        'workplan_tasks',
        'workplan_templates',
        'workplan_scheduled_tasks',
        'workplan_overtime_records',
        'workplan_leave_records',
        'workplan_notes',
        'workplan_vault_meta',
        'workplan_vault_items'
    ];
begin
    foreach target_table in array workplan_tables loop
        if to_regclass(format('public.%I', target_table)) is null then
            continue;
        end if;
        if not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = target_table
              and column_name = 'user_key'
        ) then
            raise exception 'WorkPlan table public.% is missing user_key; no changes committed', target_table;
        end if;

        -- Permissive policies combine with OR. Keeping ANY old allow-all
        -- policy would bypass the new owner policy, so replace all of them.
        for policy_row in
            select policyname from pg_policies
            where schemaname = 'public' and tablename = target_table
        loop
            execute format('drop policy %I on public.%I', policy_row.policyname, target_table);
        end loop;

        execute format('alter table public.%I enable row level security', target_table);
        execute format('alter table public.%I force row level security', target_table);
        execute format('revoke all on table public.%I from public, anon, authenticated', target_table);
        execute format('grant select, insert, update, delete on table public.%I to anon, authenticated', target_table);
        execute format(
            'create policy workplan_owner on public.%I
             for all to anon, authenticated
             using (user_key = public.workplan_request_key())
             with check (user_key = public.workplan_request_key())',
            target_table
        );

        -- BIGSERIAL legacy tables need sequence usage for insert/upsert.
        if exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = target_table
              and column_name = 'id'
        ) then
            sequence_name := pg_get_serial_sequence(format('public.%I', target_table), 'id');
            if sequence_name is not null then
                execute format('revoke all on sequence %s from public, anon, authenticated', sequence_name);
                execute format('grant usage, select on sequence %s to anon, authenticated', sequence_name);
            end if;
        end if;
    end loop;
end $$;

notify pgrst, 'reload schema';
commit;`;

export const DATABASE_PROVIDER_CATALOG = [
    {
        id: 'supabase',
        name: 'Supabase',
        databaseType: 'PostgreSQL',
        freeTier: '500 MB（超过进入只读模式）',
        paidTier: 'Pro 计划起 8 GB（然后 $0.125/GB/月）',
        notes: '免费层磁盘实际 1 GB，但数据大小限 500 MB；Pro 以上可自动扩展到 TB 级。',
        directSync: true
    },
    {
        id: 'neon',
        name: 'Neon',
        databaseType: 'PostgreSQL',
        freeTier: '0.5 GB / 项目（最多 10 项目总 5 GB）',
        paidTier: '按使用付费 $0.35/GB/月，单分支最高 16 TB',
        notes: '存储与计算分离，免费适合原型；如需直接接入本客户端，建议通过 PostgREST / Supabase 兼容网关暴露 HTTP API。',
        directSync: false
    },
    {
        id: 'nhost',
        name: 'Nhost',
        databaseType: 'PostgreSQL',
        freeTier: 'Starter 约 1 GB',
        paidTier: 'Pro 起 10 GB（然后 $0.20/GB）',
        notes: '托管 Postgres，规模化时可轻松升级；若要直连本客户端，建议使用兼容 REST 接口。',
        directSync: false
    },
    {
        id: 'turso',
        name: 'Turso',
        databaseType: 'SQLite (libSQL)',
        freeTier: '5 GB',
        paidTier: 'Developer 9 GB 起（然后 $0.50–$0.75/GB）',
        notes: '免费层很慷慨，适合多数据库场景；当前设置页可保存接入信息，后续可切换 libSQL 适配。',
        directSync: false
    },
    {
        id: 'pocketbase',
        name: 'PocketBase',
        databaseType: 'SQLite',
        freeTier: '无限制（自托管）',
        paidTier: '无（自托管）',
        notes: '容量取决于你的 VPS / 服务器磁盘大小；适合单文件数据库场景。',
        directSync: false
    },
    {
        id: 'appwrite',
        name: 'Appwrite',
        databaseType: 'MariaDB',
        freeTier: '云托管：2 GB 存储',
        paidTier: '云：150 GB+；自托管：无限制',
        notes: '自托管完全由服务器磁盘决定；云版有明确存储配额。',
        directSync: false
    },
    {
        id: 'firebase',
        name: 'Firebase (Firestore)',
        databaseType: 'NoSQL (文档型)',
        freeTier: '1 GiB 存储数据',
        paidTier: '按使用付费，无硬上限',
        notes: '单文档最大 1 MiB；总存储可扩展，但数据模型与 SQL 差异较大。',
        directSync: false
    },
    {
        id: 'self-hosted',
        name: '自托管',
        databaseType: '自定义',
        freeTier: '取决于服务器',
        paidTier: '取决于服务器',
        notes: '推荐自托管 Supabase / PostgREST / PocketBase。若使用 PostgreSQL，请先用上方 SQL 建表并暴露兼容 HTTP API。',
        directSync: true
    }
];

export function getDefaultDatabaseConfig() {
    return {
        enabled: false,
        useCustomConfig: false,
        service: 'supabase',
        url: '',
        apiKey: '',
        tableName: 'planpro_data',
        databaseName: '',
        projectId: '',
        region: '',
        notes: ''
    };
}

export function getDatabaseProviderMeta(service) {
    return DATABASE_PROVIDER_CATALOG.find((item) => item.id === service) || DATABASE_PROVIDER_CATALOG[0];
}
