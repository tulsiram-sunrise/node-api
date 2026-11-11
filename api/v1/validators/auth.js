const Joi = require("joi");

// Field names kept compatible with the previous passport-*-token clients.
const facebook = Joi.object({
    access_token: Joi.string().trim().max(4096).required(),
});

const google = Joi.object({
    id_token: Joi.string().trim().max(4096).required(),
});

module.exports = { facebook, google };
