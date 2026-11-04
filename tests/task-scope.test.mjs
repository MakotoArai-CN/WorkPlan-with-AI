import { describe, test, expect } from 'bun:test';
import { filterTasksByTimeScope } from '../src/lib/stores/ai.js';

const today = new Date(2026, 10, 4);
const yesterday = new Date(2026, 10, 3);
const scope = {
    explicit: true,
    rangeType: 'day',
    startDate: new Date(2026, 10, 4),
    endDate: new Date(2026, 10, 4, 23, 59, 59, 999),
    mentionedDate: today
};

describe('task scope for “today”', () => {
    test('includes today and overdue active tasks, but not old completed/future work', () => {
        const tasks = [
            { id: 'today', date: '2026-11-04T09:00', status: 'todo' },
            { id: 'overdue-doing', date: '2026-09-20T09:00', status: 'doing' },
            { id: 'overdue-todo', date: '2026-01-10T09:00', status: 'todo' },
            { id: 'old-done', date: '2026-09-21T09:00', status: 'done' },
            { id: 'future', date: '2026-11-05T09:00', status: 'todo' },
            { id: 'dateless', date: '', status: 'todo' }
        ];
        const result = filterTasksByTimeScope(tasks, scope, { includeOverdueActive: true });
        expect(result.map(task => task.id)).toEqual(['today', 'overdue-doing', 'overdue-todo', 'dateless']);
    });

    test('non-query views keep the strict date range', () => {
        const tasks = [
            { id: 'today', date: '2026-11-04T09:00', status: 'todo' },
            { id: 'overdue', date: '2026-09-20T09:00', status: 'doing' }
        ];
        expect(filterTasksByTimeScope(tasks, scope).map(task => task.id)).toEqual(['today']);
    });
});
