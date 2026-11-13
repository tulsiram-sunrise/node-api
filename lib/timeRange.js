/**
 * Preferred-time ranges (GAP B11): `{ start: "HH:mm", end: "HH:mm" }` in the
 * user's own time zone, so they can be compared and later matched (B16).
 *
 * parseTiming() reads v1 free text ("6-8pm", "18:00-20:00", "Evening"). It is
 * used by the migration and while older app versions still send `timing`.
 * Text it can't read with confidence returns null rather than a guess.
 */
const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/; // 24:00 = until midnight

// Named periods seen in v1 data. Fixed so conversions are predictable.
const NAMED = {
    morning: ["06:00", "12:00"],
    lunch: ["12:00", "14:00"],
    lunchtime: ["12:00", "14:00"],
    afternoon: ["12:00", "17:00"],
    evening: ["17:00", "21:00"],
};

const RANGE = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?-(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/;

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};
const fromMinutes = (total) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/** True when both are valid HH:mm and start is before end. */
function isValidRange({ start, end }) {
    return START.test(start ?? "") && END.test(end ?? "") && toMinutes(start) < toMinutes(end);
}

/** Hour (0-23, or 24 for an end of 12am) from a 12-hour clock reading. */
function clock12(hour, meridiem, isEnd) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") return hour === 12 ? (isEnd ? 24 : 0) : hour;
    return hour === 12 ? 12 : hour + 12;
}

function minutesOf(hour, minutes, meridiem, isEnd) {
    const m = minutes === undefined ? 0 : Number(minutes);
    if (m > 59) return null;
    let h = hour;
    if (meridiem) {
        h = clock12(hour, meridiem, isEnd);
        if (h === null) return null;
    } else if (h > 24 || (h === 24 && (!isEnd || m !== 0))) {
        return null;
    }
    return h * 60 + m;
}

/**
 * @param {string} text v1 free-text timing
 * @returns {{ start: string, end: string } | null}
 */
function parseTiming(text) {
    if (typeof text !== "string") return null;
    const s = text
        .toLowerCase()
        .replace(/[–—]|\bto\b|\buntil\b/g, "-")
        .replace(/\s+/g, "")
        .replace(/a\.?m\.?/g, "am")
        .replace(/p\.?m\.?/g, "pm");

    if (NAMED[s]) return { start: NAMED[s][0], end: NAMED[s][1] };

    const m = RANGE.exec(s);
    if (!m) return null;
    const [, h1, m1, mer1, h2, m2, mer2] = m;
    const startHour = Number(h1);
    const endHour = Number(h2);

    // No am/pm anywhere: only trust it as a 24-hour clock when it is plainly one
    // ("18:00-20:00", "13-15"). "6-8" could be morning or evening, so skip it.
    if (!mer1 && !mer2 && m1 === undefined && m2 === undefined && startHour <= 12 && endHour <= 12) return null;

    const end = minutesOf(endHour, m2, mer2, true);
    let start;
    if (mer1 || !mer2) {
        start = minutesOf(startHour, m1, mer1, false);
    } else {
        // "6-8pm": the start takes the end's am/pm, unless that would put it after the
        // end ("11-1pm" is 11am to 1pm).
        start = minutesOf(startHour, m1, mer2, false);
        if (start !== null && end !== null && start >= end) start = minutesOf(startHour, m1, mer2 === "pm" ? "am" : "pm", false);
    }
    if (start === null || end === null || start >= end) return null;
    return { start: fromMinutes(start), end: fromMinutes(end) };
}

/** The v1-style string for a range, for older clients that still read `timing`. */
const formatTiming = ({ start, end }) => `${start}-${end}`;

/** Canonical IANA name ("US/Eastern" -> "America/New_York"), or null if unknown. */
function canonicalTimeZone(name) {
    if (typeof name !== "string" || name.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name)) return null;
    try {
        return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
    } catch {
        return null;
    }
}

module.exports = { START, END, isValidRange, parseTiming, formatTiming, canonicalTimeZone };
