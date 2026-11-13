/**
 * Sample users for local testing of nearby search (GAP B27).
 *
 * Pure functions with no database access. scripts/seed.js writes the result.
 * Every seed user has a Google ID starting with SEED_PREFIX, so the seed can be
 * re-run (an upsert per user) or removed without touching real accounts. Names
 * are obviously fake, and there are no emails or photos.
 */
const { toPoint } = require("../../lib/geo");

const SEED_PREFIX = "seed-";
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMINGS = ["Morning", "Lunchtime", "Afternoon", "Evening", "18:00-20:00", "07:00-08:30"];
const MILES_PER_DEGREE_LAT = 69.0;

/** Small seeded PRNG (mulberry32), so a given --seed always gives the same users. */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A point uniformly spread over a disc of `radiusMiles` round `center`.
 * Uses a flat-earth offset, which is accurate enough for seed data below 100 miles.
 */
function pointNear(center, radiusMiles, random) {
    const r = radiusMiles * Math.sqrt(random());
    const bearing = 2 * Math.PI * random();
    const lat = center.lat + (r * Math.cos(bearing)) / MILES_PER_DEGREE_LAT;
    const lng = center.lng + (r * Math.sin(bearing)) / (MILES_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180));
    return { lat: round6(lat), lng: round6(lng) };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const pick = (list, random) => list[Math.floor(random() * list.length)];

/**
 * @param {{ count: number, center: { lat: number, lng: number }, radiusMiles: number, seed?: number, discoverableShare?: number }} options
 * @returns {object[]} plain user documents, ready for an upsert keyed on google.id
 */
function generateSeedUsers({ count, center, radiusMiles, seed = 1, discoverableShare = 0.8 }) {
    const random = prng(seed);
    const now = new Date();
    return Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const days = DAYS.filter(() => random() < 0.3);
        const discoverable = random() < discoverableShare;
        return {
            provider: "google",
            google: { id: `${SEED_PREFIX}${n}` },
            name: `Seed User ${n}`,
            level: pick(LEVELS, random),
            location: toPoint(pointNear(center, radiusMiles, random)),
            discoverable,
            ...(discoverable ? { discoverableSince: now } : {}),
            setting: {
                distance: pick([5, 10, 20, 50], random),
                preferredTime: days.map((day) => ({ day, timing: pick(TIMINGS, random) })),
            },
        };
    });
}

module.exports = { SEED_PREFIX, generateSeedUsers, pointNear, prng };
