const Joi = require("joi");
const { LEVELS, DAYS } = require("../models/user");
const { COUNTRY_CODES } = require("../../../lib/countries");

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

const setting = Joi.object({
    distance: Joi.number().min(1).max(100).required(),
    preferredTime: Joi.array()
        .items(
            Joi.object({
                day: Joi.string()
                    .valid(...DAYS)
                    .required(),
                timing: Joi.string().trim().max(50).required(),
            })
        )
        .max(21)
        .required(),
});

const nearbyQuery = Joi.object({
    distance: Joi.number().min(1).max(100),
    level: Joi.string().valid(...LEVELS),
    limit: Joi.number().integer().min(1).max(50).default(20),
    // Opaque value from a previous page's `nextCursor` (B7).
    cursor: Joi.string()
        .max(512)
        .pattern(/^[A-Za-z0-9_-]+$/),
});

module.exports = { profile, level, discoverable, location, setting, nearbyQuery };
