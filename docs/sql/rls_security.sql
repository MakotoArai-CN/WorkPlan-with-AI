-- WorkPlan Supabase RLS hardening. Execute as the project database owner in
-- SQL Editor, NOT with the public client key. Safe to rerun; no rows deleted.
-- The legacy planpro_data table is covered even without cloud_schema.sql.
-- Custom table names require a reviewed explicit addition to the allowlist.
--
-- Identity is a bearer capability, NOT Supabase Auth: the client supplies the
-- complete record key in x-workplan-key. Anyone knowing a key can impersonate
-- it. If rows/keys were public, first contain exposure, then rotate compromised
-- account secrets with a backed-up migration. RLS cannot undo a prior leak.

begin;

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
commit;

-- Both rowsecurity and force_rowsecurity must be true; policy_count must be 1.
select c.relname as table_name, c.relrowsecurity as rowsecurity,
       c.relforcerowsecurity as force_rowsecurity, count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname = any (array[
      'planpro_data', 'workplan_accounts', 'workplan_sync_state',
      'workplan_tasks', 'workplan_templates', 'workplan_scheduled_tasks',
      'workplan_overtime_records', 'workplan_leave_records', 'workplan_notes',
      'workplan_vault_meta', 'workplan_vault_items'
  ])
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;
