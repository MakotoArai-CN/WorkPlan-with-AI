-- Run AFTER rls_security.sql as owner in Supabase SQL Editor. This tests the
-- real anon policies, not the owner/BYPASSRLS role. Every fixture is rolled
-- back; no existing rows are edited or deleted. Never remove ROLLBACK.
begin;

set local role anon;

do $$
declare
    prefix text := 'workplan_rls_probe_' || replace(gen_random_uuid()::text, '-', '');
    key_a text;
    key_b text;
    key_name text;
    changed integer;
    visible integer;
begin
    key_a := prefix || '_a';
    key_b := prefix || '_b';

    -- Tasks and every current/legacy encrypted domain use the same table.
    foreach key_name in array array[
        key_a,
        '__workplan_key_bundle_v2__:' || key_a,
        '__workplan_secure_notes_v1__:' || key_a,
        '__workplan_secure_notes_v2__:' || key_a,
        '__workplan_secure_vault_v1__:' || key_a,
        '__workplan_secure_vault_v2__:' || key_a,
        '__workplan_secure_worklog_v1__:' || key_a,
        '__workplan_secure_worklog_v2__:' || key_a,
        key_b
    ] loop
        perform set_config('request.headers', jsonb_build_object('x-workplan-key', key_name)::text, true);
        insert into public.planpro_data(user_key, content, updated_at)
        values (key_name, '{"rls_probe":true}'::jsonb, 0);
        select count(*) into visible from public.planpro_data where user_key = key_name;
        if visible <> 1 then raise exception 'Own-key SELECT failed'; end if;

        update public.planpro_data set updated_at = 1 where user_key = key_name;
        get diagnostics changed = row_count;
        if changed <> 1 then raise exception 'Own-key UPDATE failed'; end if;
    end loop;

    perform set_config('request.headers', jsonb_build_object('x-workplan-key', key_a)::text, true);
    select count(*) into visible from public.planpro_data where user_key = key_b;
    if visible <> 0 then raise exception 'Cross-key SELECT is exposed'; end if;
    update public.planpro_data set updated_at = 2 where user_key = key_b;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Cross-key UPDATE is exposed'; end if;
    delete from public.planpro_data where user_key = key_b;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Cross-key DELETE is exposed'; end if;

    begin
        insert into public.planpro_data(user_key, content, updated_at)
        values (prefix || '_forged', '{}'::jsonb, 0);
        raise exception 'Cross-key INSERT is exposed';
    exception when insufficient_privilege then null;
    end;
    begin
        update public.planpro_data set user_key = prefix || '_forged' where user_key = key_a;
        raise exception 'Changing row ownership is exposed';
    exception when insufficient_privilege then null;
    end;

    perform set_config('request.headers', '{}', true);
    select count(*) into visible from public.planpro_data where user_key in (key_a, key_b);
    if visible <> 0 then raise exception 'Missing-header SELECT is exposed'; end if;

    perform set_config('request.headers', jsonb_build_object('x-workplan-key', key_a)::text, true);
    delete from public.planpro_data where user_key = key_a;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Own-key DELETE failed'; end if;
    raise notice 'RLS probes passed; all fixture changes will be rolled back';
end $$;

rollback;
