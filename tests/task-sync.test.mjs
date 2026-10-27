import { describe, test, expect } from 'bun:test';
import {
    mergeCollection,
    mergeSyncState,
    normalizeSyncPayload,
    stableItemString
} from '../src/lib/utils/task-sync.js';

const task = (id, title, extra = {}) => ({ id, title, date: '2026-10-27T09:00', status: 'todo', ...extra });

describe('stableItemString', () => {
    test('ignores UI-only fields', () => {
        expect(stableItemString(task('1', 'A', { expanded: true, isFromSchedule: true })))
            .toBe(stableItemString(task('1', 'A')));
    });
});

describe('mergeCollection', () => {
    test('keeps tasks created offline while the cloud was unreachable', () => {
        const local = [task('offline-1', '离线新建')];
        const remote = [task('cloud-1', '云端任务')];
        const merged = mergeCollection(local, remote, null);
        expect(merged.map(item => item.id)).toEqual(['cloud-1', 'offline-1']);
    });

    test('keeps cloud-only items from another device', () => {
        const merged = mergeCollection([task('local-1', '本地')], [task('remote-1', '其他设备')], []);
        expect(merged.map(item => item.id).sort()).toEqual(['local-1', 'remote-1']);
    });

    test('local edits win over the same id', () => {
        const baseline = [task('1', '旧标题')];
        const local = [task('1', '离线改过')];
        const remote = [task('1', '旧标题')];
        const merged = mergeCollection(local, remote, baseline);
        expect(merged[0].title).toBe('离线改过');
    });

    test('remote edits win when the local copy is unchanged', () => {
        const baseline = [task('1', '旧标题')];
        const local = [task('1', '旧标题')];
        const remote = [task('1', '其他设备改过')];
        const merged = mergeCollection(local, remote, baseline);
        expect(merged[0].title).toBe('其他设备改过');
    });

    test('local deletion is applied even if the cloud still has the item', () => {
        const baseline = [task('1', '要删除'), task('2', '保留')];
        const local = [task('2', '保留')];
        const remote = [task('1', '要删除'), task('2', '保留')];
        const merged = mergeCollection(local, remote, baseline);
        expect(merged.map(item => item.id)).toEqual(['2']);
    });

    test('remote deletion wins for an unchanged local copy', () => {
        const baseline = [task('1', '旧任务')];
        const local = [task('1', '旧任务')];
        const remote = [];
        expect(mergeCollection(local, remote, baseline)).toEqual([]);
    });

    test('a locally edited task survives a remote deletion', () => {
        const baseline = [task('1', '旧任务')];
        const local = [task('1', '本地改过')];
        const merged = mergeCollection(local, [], baseline);
        expect(merged.map(item => item.title)).toEqual(['本地改过']);
    });

    test('handles a first sync without a baseline', () => {
        const merged = mergeCollection([task('local', '本地')], [task('remote', '远程')], null);
        expect(merged).toHaveLength(2);
    });

    test('keeps items without ids instead of dropping them', () => {
        const merged = mergeCollection([{ title: '无 id 本地' }], [{ title: '无 id 远程' }], null);
        expect(merged).toHaveLength(2);
    });
});

describe('mergeSyncState', () => {
    test('merges all four collections', () => {
        const merged = mergeSyncState(
            {
                tasks: [task('t-local', '本地任务')],
                templates: [{ id: 'tpl-local', title: '本地模板' }],
                scheduledTasks: [{ id: 'sch-local', title: '本地区时', repeatDays: [1] }],
                overtimeRecords: [{ id: 'ot-local', date: '2026-10-26', hours: 2 }],
                leaveRecords: [{ id: 'leave-local', startDate: '2026-10-26' }]
            },
            {
                tasks: [task('t-cloud', '云端任务')],
                templates: [{ id: 'tpl-cloud', title: '云端模板' }],
                scheduledTasks: [{ id: 'sch-cloud', title: '云端定时', repeatDays: [2] }],
                overtimeRecords: [{ id: 'ot-cloud', date: '2026-10-25', hours: 3 }],
                leaveRecords: [{ id: 'leave-cloud', startDate: '2026-10-25' }]
            },
            null
        );
        expect(merged.tasks).toHaveLength(2);
        expect(merged.templates).toHaveLength(2);
        expect(merged.scheduledTasks).toHaveLength(2);
        expect(merged.overtimeRecords).toHaveLength(2);
        expect(merged.leaveRecords).toHaveLength(2);
    });

    test('normalizes malformed cloud payloads', () => {
        expect(normalizeSyncPayload({ tasks: {}, templates: 'x' })).toEqual({
            tasks: [],
            templates: [],
            scheduledTasks: [],
            overtimeRecords: [],
            leaveRecords: []
        });
    });
});
