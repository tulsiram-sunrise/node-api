/**
 * Convert v1 preferred times ({ day, timing: free text }) to B11 ranges
 * ({ day, start, end }). Shared by the migration and the read-only preview
 * (scripts/preview-preferred-time.js), so the preview shows exactly what the
 * migration will do.
 */
const { parseTiming } = require("../../lib/timeRange");

/** Filter for users with at least one entry still in the v1 shape. */
const LEGACY_FILTER = { "setting.preferredTime.timing": { $exists: true } };

/**
 * @param {Array<{ day: string, timing?: string, start?: string, end?: string }>} items
 * @returns {{ items: Array<{ day: string, start: string, end: string }>, dropped: string[] }}
 */
function convertPreferredTimes(items) {
    const converted = [];
    const dropped = [];
    for (const item of items ?? []) {
        if (item.start !== undefined && item.end !== undefined) {
            converted.push({ day: item.day, start: item.start, end: item.end });
            continue;
        }
        const range = parseTiming(item.timing);
        if (range) converted.push({ day: item.day, ...range });
        else dropped.push(String(item.timing ?? ""));
    }
    return { items: converted, dropped };
}

/**
 * Walk every legacy user, calling `onUser(user, result)`, and tally the outcome.
 * @param {import("mongodb").Db} db
 */
async function scanLegacy(db, onUser = async () => {}) {
    const stats = { users: 0, converted: 0, dropped: 0, unreadable: new Map() };
    const cursor = db.collection("users").find(LEGACY_FILTER, { projection: { "setting.preferredTime": 1 } });
    for await (const user of cursor) {
        const result = convertPreferredTimes(user.setting.preferredTime);
        stats.users += 1;
        stats.converted += result.items.length;
        stats.dropped += result.dropped.length;
        for (const text of result.dropped) stats.unreadable.set(text, (stats.unreadable.get(text) ?? 0) + 1);
        await onUser(user, result);
    }
    return stats;
}

/** One-paragraph report, with the most common unreadable values. */
function report(stats, { preview = false } = {}) {
    const [converted, dropped] = preview ? ["would be converted", "would be dropped"] : ["converted", "dropped"];
    const top = [...stats.unreadable.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([text, n]) => `  ${JSON.stringify(text.slice(0, 50))} x${n}`);
    return [
        `preferredTime (B11): ${stats.users} user(s) with legacy entries; ${stats.converted} entr(ies) ${converted}, ${stats.dropped} unreadable entr(ies) ${dropped}.`,
        ...(top.length ? ["Most common unreadable values:", ...top] : []),
    ].join("\n");
}

module.exports = { LEGACY_FILTER, convertPreferredTimes, scanLegacy, report };
