-- WorkPlan lightweight local database (SQLite 3.35+)
--
-- Design goals:
--   * One generic `records` table instead of one table per entity. Payload is
--     JSON, so adding a field does not need a migration.
--   * Only three tables total (+ optional FTS), small enough for mobile.
--   * Works offline-first; `outbox` records local changes that still need push.
--   * Encrypted collections (locked notes / vault) store ciphertext in payload;
--     only unlocked note plaintext is indexed for local search.

pragma journal_mode = WAL;
pragma synchronous = NORMAL;
pragma foreign_keys = ON;
pragma busy_timeout = 5000;

-- App metadata, sync cursors, schema version, UI preferences cache.
create table if not exists meta (
    key   text primary key,
    value text
) without rowid;

-- All syncable entities.
-- collection: tasks | templates | scheduled | overtime | leave | notes | vault
-- payload:    canonical JSON for tasks/worklog, or an encrypted envelope for
--             locked notes/vault entries
-- sort_key:   optional date/time used by year/month/day views
-- deleted_at: soft-delete tombstone (epoch ms)
create table if not exists records (
    collection text not null,
    id         text not null,
    payload    text not null,
    sort_key   text,
    updated_at integer not null,
    deleted_at integer,
    primary key (collection, id)
) without rowid;

create index if not exists idx_records_sync
    on records (collection, updated_at)
    where deleted_at is null;

create index if not exists idx_records_sort
    on records (collection, sort_key)
    where deleted_at is null;

-- Local changes waiting to be pushed. One row per entity; the latest op wins.
create table if not exists outbox (
    collection text not null,
    id         text not null,
    op         text not null check (op in ('upsert', 'delete')),
    changed_at integer not null,
    primary key (collection, id)
) without rowid;

create index if not exists idx_outbox_age on outbox (changed_at);

-- Full-text search is local-only and only contains unlocked note plaintext.
-- Locked notes are deliberately excluded.
create virtual table if not exists note_fts using fts5(
    note_id unindexed,
    title,
    body,
    tokenize = 'porter'
);

-- Optional performance example for date-heavy queries:
-- create index if not exists idx_tasks_date
--     on records (json_extract(payload, '$.date'))
--     where collection = 'tasks' and deleted_at is null;

-- Migration from localStorage:
--   1. export the existing JSON backup;
--   2. insert each entity as a `records` row (payload = JSON.stringify(entity));
--   3. set meta('schema_version') = '1' and meta('migrated_at') = now.
-- Keep localStorage as a read-only fallback for one release.
