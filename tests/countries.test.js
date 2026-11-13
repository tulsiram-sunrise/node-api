const { COUNTRY_CODES } = require("../lib/countries");

describe("COUNTRY_CODES (B12)", () => {
    it("lists all 249 ISO 3166-1 alpha-2 codes once, in order", () => {
        expect(COUNTRY_CODES).toHaveLength(249);
        expect(new Set(COUNTRY_CODES).size).toBe(249);
        expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
        expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
        expect(Object.isFrozen(COUNTRY_CODES)).toBe(true);
    });

    it("contains only codes Intl knows as regions, so a typo fails", () => {
        const names = new Intl.DisplayNames(["en"], { type: "region" });
        const unknown = COUNTRY_CODES.filter((code) => {
            const name = names.of(code);
            return !name || name === code || name === "Unknown Region";
        });
        expect(unknown).toEqual([]);
    });

    it("leaves out regions that aren't ISO-assigned countries", () => {
        for (const code of ["EU", "UN", "XK", "ZZ", "UK"]) expect(COUNTRY_CODES).not.toContain(code);
    });
});
