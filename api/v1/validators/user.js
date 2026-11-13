const Joi = require("joi");
const { LEVELS, DAYS } = require("../models/user");

const level = Joi.object({
    level: Joi.string()
        .valid(...LEVELS)
        .required(),
});

// PATCH /users/me (B5). At least one field; null removes the photo. Only https
// URLs, so clients never render javascript:/data: links. The server never
// fetches the URL (no SSRF).
const profile = Joi.object({
    name: Joi.string().trim().min(1).max(100),
    profilePic: Joi.string()
        .trim()
        .uri({ scheme: ["https"] })
        .max(2048)
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
