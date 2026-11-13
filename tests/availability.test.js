const { utcOffsetMinutes, toUtcWeek, intersect, toLocalSlots, overlapSlots } = require("../lib/availability");

// Fixed instants, so daylight saving is deterministic.
const WINTER = new Date("2026-01-14T12:00:00Z");
const SUMMER = new Date("2026-07-14T12:00:00Z");
const slot = (day, start, end) => ({ day, start, end });

describe("UTC offsets", () => {
    it("follows daylight saving and half-hour zones", () => {
        expect(utcOffsetMinutes("UTC", WINTER)).toBe(0);
        expect(utcOffsetMinutes("Europe/London", WINTER)).toBe(0);
        expect(utcOffsetMinutes("Europe/London", SUMMER)).toBe(60);
        expect(utcOffsetMinutes("America/New_York", WINTER)).toBe(-300);
        expect(utcOffsetMinutes("Asia/Kolkata", SUMMER)).toBe(330);
    });
});

describe("week intervals", () => {
    it("maps local slots to the UTC week and merges touching ones", () => {
        const week = toUtcWeek([slot("Monday", "18:00", "19:00"), slot("Monday", "19:00", "20:00")], "Europe/London", SUMMER);
        expect(week).toEqual([[17 * 60, 19 * 60]]); // BST is UTC+1
    });

    it("wraps slots that cross the week boundary", () => {
        // Monday 00:30-01:30 in Paris (winter, UTC+1) is Sunday 23:30 to Monday 00:30 UTC.
        const week = toUtcWeek([slot("Monday", "00:30", "01:30")], "Europe/Paris", WINTER);
        expect(week).toEqual([
            [0, 30],
            [7 * 1440 - 30, 7 * 1440],
        ]);
    });

    it("intersects merged lists", () => {
        expect(intersect([[0, 100], [200, 300]], [[50, 250]])).toEqual([[50, 100], [200, 250]]);
        expect(intersect([[0, 10]], [[10, 20]])).toEqual([]);
    });

    it("splits back into local days, ending at 24:00", () => {
        expect(toLocalSlots([[1440 - 60, 1440 + 60]], "UTC", WINTER)).toEqual([
            slot("Monday", "23:00", "24:00"),
            slot("Tuesday", "00:00", "01:00"),
        ]);
    });
});

describe("overlapSlots (B16)", () => {
    it("returns the shared times in my zone", () => {
        const mine = { timeZone: "Europe/London", slots: [slot("Monday", "18:00", "21:00"), slot("Sunday", "22:00", "24:00")] };
        const theirs = {
            timeZone: "Europe/Paris",
            slots: [slot("Monday", "20:00", "23:00"), slot("Monday", "00:00", "02:00")],
        };
        expect(overlapSlots(mine, theirs, WINTER)).toEqual([
            slot("Monday", "19:00", "21:00"), // Paris 20:00-22:00
            slot("Sunday", "23:00", "24:00"), // Paris Monday 00:00-01:00, across the week boundary
        ]);
    });

    it("matches across distant zones and days", () => {
        // 21:00-23:00 Monday in New York (winter, UTC-5) is 02:00-04:00 Tuesday in London.
        const mine = { timeZone: "Europe/London", slots: [slot("Tuesday", "03:00", "06:00")] };
        const theirs = { timeZone: "America/New_York", slots: [slot("Monday", "21:00", "23:00")] };
        expect(overlapSlots(mine, theirs, WINTER)).toEqual([slot("Tuesday", "03:00", "04:00")]);
    });

    it("is empty when nothing overlaps, or a side has no slots", () => {
        const mine = { timeZone: "UTC", slots: [slot("Monday", "09:00", "10:00")] };
        expect(overlapSlots(mine, { timeZone: "UTC", slots: [slot("Monday", "10:00", "11:00")] }, WINTER)).toEqual([]);
        expect(overlapSlots(mine, { timeZone: "UTC", slots: [] }, WINTER)).toEqual([]);
        expect(overlapSlots(mine, { timeZone: "UTC", slots: undefined }, WINTER)).toEqual([]);
    });
});
