const Joi = require("joi");
const { LEVELS, DAYS } = require("../models/user");
const { COUNTRY_CODES } = require("../../../lib/countries");
const { START, END, isValidRange, parseTiming, canonicalTimeZone } = require("../../../lib/timeRange");

const level = Joi.object({
    level: Joi.string()
        .valid(...LEVELS)
        .required(),
});

// PATCH /users/me (B5). At least one field; null removes the photo. Only https
// URLs, so clients never render javascript:/data: links. The server never
// fetches the URL (no SSRF). countryCode is ISO 3166-1 alpha-2 (B12), any case
// in, upper case stored; null removes it.
const profile = Joi.object({
    name: Joi.string().trim().min(1).max(100),
    profilePic: Joi.string()
        .trim()
        .uri({ scheme: ["https"] })
        .max(2048)
        .allow(null),
    countryCode: Joi.string()
        .trim()
        .uppercase()
        .valid(...COUNTRY_CODES)
        .allow(null),
}).min(1);

const discoverable = Joi.object({
    discoverable: Joi.boolean().strict().required(),
});

const location = Joi.object({
    location: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required(),
    }).required(),
});

// B11: each preferred time is { day, start, end } ("HH:mm", start before end,
// end may be "24:00"). Older app versions may still send { day, timing } as
// free text. It is converted when it can be read unambiguously ("6-8pm",
// "18:00-20:00", "Evening"), and rejected otherwise.
const preferredTimeItem = Joi.object({
    day: Joi.string()
        .valid(...DAYS)
        .required(),
    start: Joi.string().pattern(START),
    end: Joi.string().pattern(END),
    timing: Joi.string().trim().max(50),
})
    .xor("start", "timing")
    .and("start", "end")
    .oxor("end", "timing")
    .custom((item, helpers) => {
        const range = item.timing === undefined ? { start: item.start, end: item.end } : parseTiming(item.timing);
        if (!range) return helpers.message('"timing" could not be read; send "start" and "end" as HH:mm instead');
        if (!isValidRange(range)) return helpers.message('"end" must be after "start"');
        return { day: item.day, ...range };
    });

const setting = Joi.object({
    distance: Joi.number().min(1).max(100).required(),
    preferredTime: Joi.array().items(preferredTimeItem).max(21).required(),
    // IANA name such as "Europe/London". Optional so older app versions keep
    // working; omitting it leaves the stored zone unchanged.
    timeZone: Joi.string()
        .max(64)
        .custom((tz, helpers) => canonicalTimeZone(tz) ?? helpers.message('"timeZone" must be an IANA time zone such as "Europe/London"')),
});

const nearbyQuery = Joi.object({
    distance: Joi.number().min(1).max(100),
    level: Joi.string().valid(...LEVELS),
    limit: Joi.number().integer().min(1).max(50).default(20),
    // B16: only users whose preferred times overlap the caller's.
    matchTimes: Joi.boolean().default(false),
    // Opaque value from a previous page's `nextCursor` (B7).
    cursor: Joi.string()
        .max(512)
        .pattern(/^[A-Za-z0-9_-]+$/),
});

module.exports = { profile, level, discoverable, location, setting, nearbyQuery };
