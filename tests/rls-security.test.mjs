import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const TABLES = [
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

describe('Supabase RLS hardening', () => {
    test('migration enables RLS and covers every public WorkPlan table', () => {
        const sql = read('docs/sql/rls_security.sql');
        expect(sql).toContain('enable row level security');
        expect(sql).toContain('workplan_owner');
        expect(sql).toContain('workplan_request_key');
        expect(sql).toContain("x-workplan-key");
        expect(sql).toContain('force row level security');
        expect(sql).toContain('begin;');
        expect(sql).toContain('commit;');
        expect(sql).toContain('select policyname from pg_policies');
        expect(sql).toContain('with check (user_key = public.workplan_request_key())');
        expect(sql).not.toContain("->> 'workplan_key'");
        const executableSql = sql.replace(/--.*$/gm, '');
        expect(executableSql).not.toMatch(/using\s*\(\s*true\s*\)/i);
        for (const table of TABLES) {
            expect(sql).toContain(`'${table}'`);
        }
    });

    test('schema documentation marks RLS as required', () => {
        const schema = read('docs/sql/cloud_schema.sql');
        expect(schema).toContain('Row Level Security (REQUIRED for Supabase)');
        expect(schema).toContain('rls_security.sql');
        expect(schema).not.toContain('Row Level Security (optional, Supabase)');
    });

    test('in-app setup SQL is safe by default', () => {
        const providers = read('src/lib/utils/database-providers.js');
        expect(providers).toContain('enable row level security');
        expect(providers).toContain('force row level security');
        expect(providers).toContain('workplan_owner');
        expect(providers).toContain('x-workplan-key');
        expect(providers).toContain('select policyname from pg_policies');
        expect(providers).not.toContain('FOR ALL TO public');
    });

    test('client sends the RLS key header and rejects privileged keys', () => {
        const tasks = read('src/lib/stores/tasks.js');
        expect(tasks).toContain("'x-workplan-key': accessKey");
        expect(tasks).toContain("global:");
        expect(tasks).toContain('assertPublicDatabaseKey(databaseConfig)');
        expect(tasks).not.toContain(".select('content, updated_at')\n        .eq('user_key', accessKey)");
    });

    test('deployment instructions distinguish local checks from actual owner-side remediation', () => {
        const instructions = read('docs/SUPABASE_SECURITY.md');
        expect(instructions).toContain('hosted database has not been modified or verified');
        expect(instructions).toContain('previously public credentials as compromised');
        expect(instructions).toContain('additional authenticated data');
        const probes = read('docs/sql/verify_rls.sql');
        expect(probes).toContain('set local role anon;');
        expect(probes).toContain('rollback;');
        expect(probes).toContain('Cross-key DELETE is exposed');
        expect(probes).toContain('Changing row ownership is exposed');
    });
});
