// The AI layers each carried their own status/priority alias table and drifted
// apart, so plan-created tasks silently landed at the wrong priority. These
// tests pin the shared vocabulary, including the distinction that matters most:
// resolve* returns null for unknown input (so partial updates can drop the
// field) while normalize* falls back to a default (for newly created items).
import { describe, test, expect } from 'bun:test';
import {
    TASK_STATUSES,
    TASK_PRIORITIES,
    resolveStatus,
    resolvePriority,
    normalizeStatus,
    normalizePriority
} from '../src/lib/utils/task-vocabulary.js';

describe('canonical vocabulary', () => {
    test('canonical values are the ones the stores persist', () => {
        expect(TASK_STATUSES).toEqual(['todo', 'doing', 'done']);
        expect(TASK_PRIORITIES).toEqual(['normal', 'urgent', 'critical']);
    });

    test('canonical values round-trip through both resolvers', () => {
        for (const status of TASK_STATUSES) {
            expect(resolveStatus(status)).toBe(status);
        }
        for (const priority of TASK_PRIORITIES) {
            expect(resolvePriority(priority)).toBe(priority);
        }
    });
});

describe('resolveStatus', () => {
    test('maps the Chinese labels the UI and prompts use', () => {
        expect(resolveStatus('未开始')).toBe('todo');
        expect(resolveStatus('待办')).toBe('todo');
        expect(resolveStatus('进行中')).toBe('doing');
        expect(resolveStatus('已完成')).toBe('done');
        expect(resolveStatus('已解决')).toBe('done');
    });

    test('maps the off-schema English vocabulary models reach for', () => {
        expect(resolveStatus('pending')).toBe('todo');
        expect(resolveStatus('in_progress')).toBe('doing');
        expect(resolveStatus('completed')).toBe('done');
        expect(resolveStatus('finished')).toBe('done');
    });

    test('is case-insensitive and tolerates surrounding whitespace', () => {
        expect(resolveStatus('  DONE  ')).toBe('done');
        expect(resolveStatus('In_Progress')).toBe('doing');
    });

    test('returns null for absent or unrecognized input', () => {
        expect(resolveStatus(undefined)).toBeNull();
        expect(resolveStatus(null)).toBeNull();
        expect(resolveStatus('')).toBeNull();
        expect(resolveStatus('   ')).toBeNull();
        // A status the app has no concept of must not silently become 'todo' in
        // an update path — that would reset a task the user never touched.
        expect(resolveStatus('blocked')).toBeNull();
        expect(resolveStatus('已取消')).toBeNull();
    });
});

describe('resolvePriority', () => {
    test('maps the Chinese labels', () => {
        expect(resolvePriority('普通')).toBe('normal');
        expect(resolvePriority('一般')).toBe('normal');
        expect(resolvePriority('紧急')).toBe('urgent');
        expect(resolvePriority('重要')).toBe('urgent');
        expect(resolvePriority('特急')).toBe('critical');
        expect(resolvePriority('最优先')).toBe('critical');
    });

    test('maps the generic high/medium/low scale models emit off-schema', () => {
        // This is the drift that made every plan-created task land at normal:
        // the plan prompt advertised "high|normal|low" while the app only knew
        // "normal|urgent|critical".
        expect(resolvePriority('high')).toBe('urgent');
        expect(resolvePriority('highest')).toBe('critical');
        expect(resolvePriority('medium')).toBe('normal');
        expect(resolvePriority('low')).toBe('normal');
    });

    test('maps the P0/P1/P2 scale', () => {
        expect(resolvePriority('p0')).toBe('critical');
        expect(resolvePriority('P1')).toBe('urgent');
        expect(resolvePriority('p2')).toBe('normal');
    });

    test('returns null for absent or unrecognized input', () => {
        expect(resolvePriority(undefined)).toBeNull();
        expect(resolvePriority('')).toBeNull();
        expect(resolvePriority('blocker')).toBeNull();
    });
});

// The alias tables were plain object literals, so `table['toString']` walked up to
// Object.prototype and the lookup returned a *function*. Via task_create that
// function was assigned to `priority` and then dropped by JSON serialization, so
// the field silently went missing rather than falling back to a default.
describe('inherited Object.prototype keys are not aliases', () => {
    const PROTOTYPE_KEYS = [
        'toString',
        'valueOf',
        'constructor',
        'hasOwnProperty',
        '__proto__',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString'
    ];

    test('resolve* returns null for every inherited key', () => {
        for (const key of PROTOTYPE_KEYS) {
            expect(resolveStatus(key)).toBeNull();
            expect(resolvePriority(key)).toBeNull();
        }
    });

    test('normalize* falls back to the default, never a function or object', () => {
        for (const key of PROTOTYPE_KEYS) {
            expect(normalizeStatus(key)).toBe('todo');
            expect(normalizePriority(key)).toBe('normal');
        }
    });

    test('resolved values are always strings when not null', () => {
        for (const input of [...PROTOTYPE_KEYS, '已完成', 'high', 'garbage']) {
            for (const resolved of [resolveStatus(input), resolvePriority(input)]) {
                if (resolved !== null) expect(typeof resolved).toBe('string');
            }
        }
    });
});

describe('normalize* fallbacks', () => {
    test('unknown input falls back to the creation default', () => {
        expect(normalizeStatus('blocked')).toBe('todo');
        expect(normalizeStatus(undefined)).toBe('todo');
        expect(normalizePriority('blocker')).toBe('normal');
        expect(normalizePriority(undefined)).toBe('normal');
    });

    test('recognized input is preserved, not defaulted', () => {
        expect(normalizeStatus('已完成')).toBe('done');
        expect(normalizePriority('high')).toBe('urgent');
    });

    test('output is always a canonical value', () => {
        const inputs = ['', 'garbage', '进行中', 'p0', null, undefined, 42];
        for (const input of inputs) {
            expect(TASK_STATUSES).toContain(normalizeStatus(input));
            expect(TASK_PRIORITIES).toContain(normalizePriority(input));
        }
    });
});
