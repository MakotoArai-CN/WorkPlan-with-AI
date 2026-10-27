-- WorkPlan cloud schema (PostgreSQL / Supabase)
--
-- Design goals:
--   * One row per entity, indexed by (user_key, updated_at) for incremental sync.
--   * Ciphertext-only columns for notes and vault items; the server never sees
--     plaintext or the master password.
--   * Soft deletes via deleted_at so an offline client can merge tombstones.
--   * A legacy JSONB snapshot table keeps old clients working during migration.
--
-- Run this once per Supabase project (or any Postgres 14+ instance).
-- The application's legacy `planpro_data` table is intentionally left in place.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Account / sync metadata
-- ---------------------------------------------------------------------------

create table if not exists workplan_accounts (
    id              uuid primary key default gen_random_uuid(),
    user_key        text not null unique,
    display_name    text,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);

create table if not exists workplan_sync_state (
    user_key        text primary key references workplan_accounts(user_key) on delete cascade,
    schema_version  integer not null default 1,
    notes_version   bigint not null default 0,
    vault_version   bigint not null default 0,
    worklog_version bigint not null default 0,
    updated_at      timestamptz not null default now()
);

-- Legacy single-blob table used by <= 0.3.13 clients. Kept for rollback.
create table if not exists planpro_data (
    user_key        text primary key,
    content         jsonb,
    updated_at      bigint
);

-- ---------------------------------------------------------------------------
-- Tasks / templates / schedules / worklog
-- ---------------------------------------------------------------------------

create table if not exists workplan_tasks (
    user_key        text not null,
    id              text not null,
    title           text not null,
    status          text not null default 'todo',
    priority        text not null default 'normal',
    task_date       date,
    deadline        timestamptz,
    note            text,
    subtasks        jsonb not null default '[]'::jsonb,
    completed_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_tasks_sync
    on workplan_tasks (user_key, updated_at desc)
    where deleted_at is null;
create index if not exists idx_workplan_tasks_date
    on workplan_tasks (user_key, task_date);

create table if not exists workplan_templates (
    user_key        text not null,
    id              text not null,
    title           text not null,
    payload         jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_templates_sync
    on workplan_templates (user_key, updated_at desc)
    where deleted_at is null;

create table if not exists workplan_scheduled_tasks (
    user_key        text not null,
    id              text not null,
    title           text not null,
    enabled         boolean not null default true,
    repeat_days     smallint[] not null default '{}',
    last_generated  date,
    payload         jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_schedules_sync
    on workplan_scheduled_tasks (user_key, updated_at desc)
    where deleted_at is null;

create table if not exists workplan_overtime_records (
    user_key        text not null,
    id              text not null,
    work_date       date not null,
    start_time      time not null,
    end_time        time not null,
    hours           numeric(6,2) not null check (hours >= 0 and hours <= 24),
    kind            text not null default 'weekday'
                    check (kind in ('weekday','weekend','holiday')),
    compensation    text not null default 'pay'
                    check (compensation in ('pay','time_off','none')),
    note            text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_overtime_sync
    on workplan_overtime_records (user_key, updated_at desc)
    where deleted_at is null;
create index if not exists idx_workplan_overtime_date
    on workplan_overtime_records (user_key, work_date);

create table if not exists workplan_leave_records (
    user_key        text not null,
    id              text not null,
    start_date      date not null,
    end_date        date not null,
    unit            text not null default 'day' check (unit in ('day','hour')),
    duration        numeric(6,2) not null check (duration > 0),
    leave_type      text not null default 'annual',
    paid            boolean not null default true,
    note            text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id),
    check (end_date >= start_date)
);
create index if not exists idx_workplan_leave_sync
    on workplan_leave_records (user_key, updated_at desc)
    where deleted_at is null;
create index if not exists idx_workplan_leave_range
    on workplan_leave_records (user_key, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Notes: client-side encrypted, compressed ciphertext only
-- ---------------------------------------------------------------------------

create table if not exists workplan_notes (
    user_key        text not null,
    id              text not null,
    title           text not null default '',
    -- client-encrypted payload (AES-GCM or AES-CBC+HMAC). Prefixed with the
    -- client format version, e.g. "wp1:<base64>".
    ciphertext      text,
    -- whether the client compressed the plaintext before encrypting
    compressed      boolean not null default true,
    -- encrypted notes are not uploaded unless the user opts in
    locked          boolean not null default false,
    category        text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_notes_sync
    on workplan_notes (user_key, updated_at desc)
    where deleted_at is null;
create index if not exists idx_workplan_notes_category
    on workplan_notes (user_key, category);

-- Server-side full-text search is impossible on ciphertext. Clients keep a
-- local plaintext index (SQLite) and search there.

-- ---------------------------------------------------------------------------
-- Password vault: encrypted blobs + KDF metadata only
-- ---------------------------------------------------------------------------

create table if not exists workplan_vault_meta (
    user_key        text primary key,
    kdf             text not null default 'pbkdf2-sha256',
    kdf_iterations  integer not null default 600000,
    kdf_salt        text not null,
    verifier        text not null,          -- hash of the derived key, never the password
    wrapped_key     text,                   -- data key wrapped by the master key
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists workplan_vault_items (
    user_key        text not null,
    id              text not null,
    ciphertext      text not null,          -- encrypted under the vault data key
    category        text,
    locked          boolean not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    primary key (user_key, id)
);
create index if not exists idx_workplan_vault_sync
    on workplan_vault_items (user_key, updated_at desc)
    where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

create or replace function workplan_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'workplan_tasks','workplan_templates','workplan_scheduled_tasks',
        'workplan_overtime_records','workplan_leave_records','workplan_notes',
        'workplan_vault_items','workplan_vault_meta','workplan_sync_state'
    ] loop
        execute format(
            'drop trigger if exists trg_%1$s_touch on %1$s;
             create trigger trg_%1$s_touch before update on %1$s
             for each row execute function workplan_touch_updated_at();',
            table_name
        );
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (optional, Supabase)
-- ---------------------------------------------------------------------------
-- The app authenticates with a per-user access key, not Supabase Auth. If you
-- expose these tables through the anon key, enable RLS and map the access key to
-- an authenticated JWT. Example for a JWT claim `workplan_key`:
--
-- alter table workplan_tasks enable row level security;
-- create policy workplan_tasks_owner on workplan_tasks
--   using (user_key = current_setting('request.jwt.claims', true)::json->>'workplan_key')
--   with check (user_key = current_setting('request.jwt.claims', true)::json->>'workplan_key');
--
-- Repeat for every table. Never expose the service-role key to the client.
