-- WorkPlan Supabase RLS hardening
--
-- Run this AFTER docs/sql/cloud_schema.sql in the Supabase SQL Editor.
-- It enables RLS on every WorkPlan public table and replaces any existing
-- permissive policies with one owner policy per table.
--
-- Identity model:
--   The desktop client sends its per-account access key in the
--   `x-workplan-key` request header. PostgREST exposes request headers through
--   `current_setting('request.headers')`, so RLS can require
--   `user_key = x-workplan-key`.
--
--   For a future Supabase Auth integration, the same function also accepts a
--   JWT claim named `workplan_key`:
--     auth.jwt() -> 'workplan_key'
--
-- This is a bearer-secret model. Generate long random account keys and never
-- publish them. The service_role key must never be shipped to the client.

create or replace function public.workplan_request_key()
returns text
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-workplan-key',
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'workplan_key'
    );
$$;

comment on function public.workplan_request_key() is
    'Per-account key supplied by WorkPlan; used only by RLS owner policies.';

-- Keep the helper callable by API roles. It is not a secret itself; it only
-- reads the current request context.
revoke all on function public.workplan_request_key() from public;
grant execute on function public.workplan_request_key() to anon, authenticated;

-- Remove all old policies on WorkPlan tables. This is intentional: a single
-- leftover `using (true)` policy would keep the whole table public.
do $$
declare
    policy_row record;
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
    for policy_row in
        select policyname, tablename
        from pg_policies
        where schemaname = 'public'
          and tablename = any (workplan_tables)
    loop
        execute format(
            'drop policy if exists %I on public.%I',
            policy_row.policyname,
            policy_row.tablename
        );
    end loop;
end $$;

do $$
declare
    table_name text;
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
    foreach table_name in array workplan_tables loop
        if to_regclass(format('public.%I', table_name)) is null then
            continue;
        end if;

        execute format(
            'alter table public.%I enable row level security',
            table_name
        );

        execute format(
            'create policy workplan_owner on public.%I
             for all
             to anon, authenticated
             using (user_key = public.workplan_request_key())
             with check (user_key = public.workplan_request_key())',
            table_name
        );
    end loop;
end $$;

-- Verification: every row here should show rowsecurity = true and one policy.
select
    c.relname as table_name,
    c.relrowsecurity as rowsecurity,
    count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
    on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname = any (array[
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
  ])
group by c.relname, c.relrowsecurity
order by c.relname;
