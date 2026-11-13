/**
 * Weekly availability overlap for nearby matching (GAP B16).
 *
 * Preferred times are { day, start, end } in each user's own time zone (B11).
 * To compare two users, both are mapped onto one UTC week (minutes 0..10079,
 * Monday 00:00 UTC = 0), intersected there, and the overlap is mapped back into
 * the caller's zone.
 *
 * Each zone's UTC offset is taken at `now`. During the few weeks a year when
 * two zones switch daylight saving on different dates, a match can be an hour
 * off; for people within 100 miles of each other that is almost never relevant.
 */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_MIN = 24 * 60;
const WEEK_MIN = 7 * DAY_MIN;

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const mod = (n, m) => ((n % m) + m) % m;

/** Minutes the zone is ahead of UTC at `date` (Europe/London in summer: 60). */
function utcOffsetMinutes(timeZone, date = new Date()) {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName").value; // "GMT", "GMT+01:00", "GMT-05:30"
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
}

/** Sort and merge touching or overlapping [start, end) intervals. */
function merge(intervals) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of sorted) {
        const last = out.at(-1);
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
}

/**
 * Preferred times as merged [start, end) intervals on the UTC week.
 * @param {Array<{ day: string, start: string, end: string }>} slots
 */
function toUtcWeek(slots, timeZone, now = new Date()) {
    const offset = utcOffsetMinutes(timeZone, now);
    const intervals = [];
    for (const { day, start, end } of slots ?? []) {
        const dayIndex = DAYS.indexOf(day);
        if (dayIndex < 0 || !start || !end) continue;
        const s = mod(dayIndex * DAY_MIN + toMinutes(start) - offset, WEEK_MIN);
        const length = toMinutes(end) - toMinutes(start);
        if (length <= 0) continue;
        // A slot shifted across the end of the week wraps round to Monday.
        if (s + length <= WEEK_MIN) intervals.push([s, s + length]);
        else intervals.push([s, WEEK_MIN], [0, s + length - WEEK_MIN]);
    }
    return merge(intervals);
}

/** Intersection of two merged interval lists. */
function intersect(a, b) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        const s = Math.max(a[i][0], b[j][0]);
        const e = Math.min(a[i][1], b[j][1]);
        if (s < e) out.push([s, e]);
        if (a[i][1] < b[j][1]) i += 1;
        else j += 1;
    }
    return out;
}

/** UTC-week intervals as { day, start, end } in `timeZone`, split at local midnight. */
function toLocalSlots(intervals, timeZone, now = new Date()) {
    const offset = utcOffsetMinutes(timeZone, now);
    const local = [];
    for (const [s, e] of intervals) {
        const ls = mod(s + offset, WEEK_MIN);
        const length = e - s;
        if (ls + length <= WEEK_MIN) local.push([ls, ls + length]);
        else local.push([ls, WEEK_MIN], [0, ls + length - WEEK_MIN]);
    }
    const slots = [];
    for (const [s, e] of merge(local)) {
        for (let dayStart = Math.floor(s / DAY_MIN) * DAY_MIN; dayStart < e; dayStart += DAY_MIN) {
            const from = Math.max(s, dayStart);
            const to = Math.min(e, dayStart + DAY_MIN);
            if (from < to) slots.push({ day: DAYS[dayStart / DAY_MIN], start: hhmm(from - dayStart), end: hhmm(to - dayStart) });
        }
    }
    return slots;
}

/**
 * Where `theirs` overlaps `mine`, in my time zone (empty array if nowhere).
 * @param {{ slots: object[], timeZone: string }} mine
 * @param {{ slots: object[], timeZone: string }} theirs
 */
function overlapSlots(mine, theirs, now = new Date()) {
    const shared = intersect(toUtcWeek(mine.slots, mine.timeZone, now), toUtcWeek(theirs.slots, theirs.timeZone, now));
    return toLocalSlots(shared, mine.timeZone, now);
}

module.exports = { utcOffsetMinutes, toUtcWeek, intersect, toLocalSlots, overlapSlots };
