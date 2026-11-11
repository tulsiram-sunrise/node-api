const { User } = require("../models/user");
const oauth = require("../services/oauth");
const tokens = require("../../../lib/tokens");

async function issueToken(res, identity) {
    const user = await User.upsertOAuthUser(identity);
    const token = tokens.sign(user);
    res.setHeader("x-auth-token", token);
    res.status(200).json(user);
}

module.exports = {
    facebook: async (req, res) => {
        const identity = await oauth.verifyFacebookToken(req.body.access_token);
        await issueToken(res, identity);
    },

    google: async (req, res) => {
        const identity = await oauth.verifyGoogleToken(req.body.id_token);
        await issueToken(res, identity);
    },
};
