const { parseTiming, isValidRange, formatTiming, canonicalTimeZone } = require("../lib/timeRange");

describe("parseTiming (B11)", () => {
    it.each([
        ["18:00-20:00", "18:00", "20:00"],
        ["07:00-08:30", "07:00", "08:30"],
        ["18.00–20.00", "18:00", "20:00"],
        ["13-15", "13:00", "15:00"],
        ["6-8pm", "18:00", "20:00"],
        ["6pm-8pm", "18:00", "20:00"],
        ["6:30 am - 8 pm", "06:30", "20:00"],
        ["8am - 5:30pm", "08:00", "17:30"],
        ["7 to 9 pm", "19:00", "21:00"],
        ["11-1pm", "11:00", "13:00"],
        ["10am-12pm", "10:00", "12:00"],
        ["9pm-12am", "21:00", "24:00"],
        ["6 p.m. until 8 p.m.", "18:00", "20:00"],
        ["Morning", "06:00", "12:00"],
        ["lunchtime", "12:00", "14:00"],
        ["Afternoon", "12:00", "17:00"],
        [" EVENING ", "17:00", "21:00"],
    ])("reads %j as %s-%s", (text, start, end) => {
        expect(parseTiming(text)).toEqual({ start, end });
    });

    it.each([
        "6-8", // morning or evening?
        "8-5",
        "20:00-18:00", // overnight ranges must be split per day
        "25-26",
        "18:60-19:00",
        "13pm-14pm",
        "noon-2",
        "Night",
        "after work",
        "",
        "   ",
    ])("returns null for %j instead of guessing", (text) => {
        expect(parseTiming(text)).toBeNull();
    });

    it("returns null for non-strings", () => {
        expect(parseTiming(undefined)).toBeNull();
        expect(parseTiming(18)).toBeNull();
    });
});

describe("ranges and time zones", () => {
    it("requires HH:mm with start before end; only end may be 24:00", () => {
        expect(isValidRange({ start: "00:00", end: "24:00" })).toBe(true);
        expect(isValidRange({ start: "18:00", end: "18:00" })).toBe(false);
        expect(isValidRange({ start: "24:00", end: "24:00" })).toBe(false);
        expect(isValidRange({ start: "6:00", end: "08:00" })).toBe(false);
        expect(isValidRange({ start: "06:00" })).toBe(false);
        expect(formatTiming({ start: "06:00", end: "08:00" })).toBe("06:00-08:00");
    });

    it("canonicalises IANA zones and rejects anything else", () => {
        expect(canonicalTimeZone("Europe/London")).toBe("Europe/London");
        expect(canonicalTimeZone("US/Eastern")).toBe("America/New_York");
        expect(canonicalTimeZone("UTC")).toBe("UTC");
        for (const bad of ["Mars/Olympus", "Europe/London; x", "", "a".repeat(65), 5, null]) {
            expect(canonicalTimeZone(bad)).toBeNull();
        }
    });
});
