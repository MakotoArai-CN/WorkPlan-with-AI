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
        expect(providers).toContain('ENABLE ROW LEVEL SECURITY');
        expect(providers).toContain('workplan_owner');
        expect(providers).toContain('x-workplan-key');
    });

    test('client sends the RLS key header and keeps it out of Supabase URLs', () => {
        const tasks = read('src/lib/stores/tasks.js');
        expect(tasks).toContain("'x-workplan-key': accessKey");
        expect(tasks).toContain("global:");
        expect(tasks).not.toContain(".select('content, updated_at')\n        .eq('user_key', accessKey)");
    });
});
