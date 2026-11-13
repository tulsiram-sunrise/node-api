const Joi = require("joi");
const { LEVELS, DAYS } = require("../models/user");

const level = Joi.object({
    level: Joi.string()
        .valid(...LEVELS)
        .required(),
});

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
});

module.exports = { level, discoverable, location, setting, nearbyQuery };
