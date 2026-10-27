// Local-time date helpers.
//
// Task dates are stored as local wall-clock strings ("YYYY-MM-DD" or
// "YYYY-MM-DDTHH:mm"). Using `toISOString()` for them shifts the value by the
// UTC offset: in UTC+8 hours between 00:00 and 08:00 the UTC date is still
// yesterday, and any timestamp written to `completedDate`/`startTime` is eight
// hours behind the `datetime-local` deadlines they are compared with.
//
// Keep every local-date read and write on these helpers so the format stays
// consistent across the store, the AI router and the UI.

function pad2(value) {
    return String(value).padStart(2, '0');
}

function toDate(value = new Date()) {
    return value instanceof Date ? value : new Date(value);
}

/** "YYYY-MM-DD" in the user's local timezone. */
export function formatLocalDate(value = new Date()) {
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "YYYY-MM-DDTHH:mm" in the user's local timezone (task field format). */
export function formatLocalDateTime(value = new Date()) {
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${formatLocalDate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Parse a stored local date/datetime string without letting the Date parser
 * treat "YYYY-MM-DD" as UTC midnight. Returns an invalid Date for bad input.
 */
export function parseLocalDate(value) {
    if (value instanceof Date) {
        return new Date(value.getTime());
    }
    const match = String(value ?? '').trim().match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (!match) {
        return new Date(NaN);
    }
    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0)
    );
}

/** Local midnight of the given date. */
export function startOfLocalDay(value = new Date()) {
    const date = parseLocalDate(formatLocalDate(value));
    return date;
}

/** Add whole days in local time (DST-safe because it operates on date parts). */
export function addLocalDays(value, days) {
    const date = value instanceof Date ? new Date(value.getTime()) : parseLocalDate(value);
    if (Number.isNaN(date.getTime())) return date;
    date.setDate(date.getDate() + Number(days || 0));
    return date;
}

/** True when the input is a valid calendar date. */
export function isValidLocalDate(value) {
    return !Number.isNaN(parseLocalDate(value).getTime());
}
