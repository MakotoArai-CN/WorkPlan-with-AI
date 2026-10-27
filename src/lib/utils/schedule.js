// Pure helpers for scheduled-task generation.
//
// `repeatDays` uses JavaScript's 0-based weekday (0 = Sunday); older data and
// some AI outputs used 7 for Sunday, so normalize before comparing.
// The date math is intentionally done on local calendar parts: parsing
// "YYYY-MM-DD" with `new Date()` yields UTC midnight, which shifts both the
// emitted date and the weekday in timezones west of UTC.
import { addLocalDays, formatLocalDate, parseLocalDate } from './datetime.js';

export const MAX_CATCH_UP_DAYS = 90;

export function normalizeRepeatDays(days = []) {
    if (!Array.isArray(days)) return [];
    const normalized = days
        .map(value => Number(value))
        .map(value => (value === 7 ? 0 : value))
        .filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
    return [...new Set(normalized)].sort((a, b) => a - b);
}

function cloneSubtasks(subtasks) {
    return Array.isArray(subtasks) ? JSON.parse(JSON.stringify(subtasks)) : [];
}

function createInstanceId(index) {
    return `${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Compute the task instances a set of schedules should add for `today`.
 *
 * @param {{tasks?: Array, scheduledTasks?: Array}} state
 * @param {Date|string} [todayValue] any date/time; only its local calendar day matters
 * @param {{maxCatchUpDays?: number}} [options]
 * @returns {{instances: Array, scheduledTasks: Array, changed: boolean}}
 */
export function buildScheduledInstances(state = {}, todayValue = new Date(), options = {}) {
    const todayText = formatLocalDate(todayValue);
    const today = parseLocalDate(todayText);
    const maxCatchUpDays = Number.isFinite(Number(options.maxCatchUpDays))
        ? Math.max(0, Number(options.maxCatchUpDays))
        : MAX_CATCH_UP_DAYS;

    const sourceSchedules = Array.isArray(state.scheduledTasks) ? state.scheduledTasks : [];
    const instances = [];
    let changed = false;

    const scheduledTasks = sourceSchedules.map((schedule) => {
        const repeatDays = normalizeRepeatDays(schedule?.repeatDays);
        if (!schedule?.enabled || repeatDays.length === 0) {
            // Still advance the watermark so a later enable does not replay history.
            if (schedule?.lastGeneratedDate !== todayText) {
                changed = true;
                return { ...schedule, repeatDays, lastGeneratedDate: todayText };
            }
            return schedule;
        }

        let cursor = schedule.lastGeneratedDate
            ? addLocalDays(parseLocalDate(schedule.lastGeneratedDate), 1)
            : new Date(today.getTime());

        if (maxCatchUpDays > 0) {
            const earliest = addLocalDays(today, -maxCatchUpDays);
            if (cursor.getTime() < earliest.getTime()) {
                cursor = earliest;
            }
        }

        while (cursor.getTime() <= today.getTime()) {
            const weekday = cursor.getDay();
            if (repeatDays.includes(weekday)) {
                instances.push({
                    id: createInstanceId(instances.length),
                    title: schedule.title,
                    status: 'todo',
                    priority: schedule.priority || 'normal',
                    date: `${formatLocalDate(cursor)}T09:00`,
                    deadline: '',
                    note: schedule.note || '',
                    subtasks: cloneSubtasks(schedule.subtasks),
                    expanded: false,
                    isFromSchedule: true
                });
            }
            cursor = addLocalDays(cursor, 1);
        }

        const nextWatermark = schedule.lastGeneratedDate === todayText
            ? schedule.lastGeneratedDate
            : todayText;
        if (nextWatermark !== schedule.lastGeneratedDate) {
            changed = true;
            return { ...schedule, repeatDays, lastGeneratedDate: nextWatermark };
        }
        return schedule;
    });

    return {
        instances,
        scheduledTasks,
        changed: changed || instances.length > 0
    };
}
