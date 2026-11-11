const crypto = require("node:crypto");
const config = require("config");
const { User } = require("../models/user");
const { DeletionRequest } = require("../models/deletionRequest");
const oauth = require("../services/oauth");
const tokens = require("../../../lib/tokens");
const HttpError = require("../../../lib/httpError");
const logger = require("../../../lib/logger");

async function issueToken(res, identity) {
    const user = await User.upsertOAuthUser(identity);
    const token = tokens.sign(user);
    res.setHeader("x-auth-token", token);
    res.status(200).json(user);
}

function publicBaseUrl(req) {
    const configured = config.get("publicUrl");
    return (configured || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
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

    /**
     * Facebook data-deletion callback (GAP B1). Meta POSTs a form-encoded
     * signed_request; we delete the user and answer with a status URL and a
     * confirmation code, as Meta's platform policy requires.
     */
    facebookDataDeletion: async (req, res) => {
        const { user_id: facebookId } = oauth.parseFacebookSignedRequest(req.body.signed_request);

        const deleted = await User.findOneAndDelete({ "facebook.id": String(facebookId) });
        const code = crypto.randomBytes(16).toString("hex");
        await DeletionRequest.create({ code, provider: "facebook" });

        // No user identifiers in the log; the code is enough to trace it.
        logger.info("Facebook data deletion processed", {
            confirmationCode: code,
            userFound: Boolean(deleted),
            requestId: req.id,
        });

        res.json({
            url: `${publicBaseUrl(req)}/api/v1/auth/facebook/data-deletion/${code}`,
            confirmation_code: code,
        });
    },

    dataDeletionStatus: async (req, res) => {
        const { code } = req.validated.params;
        const request = await DeletionRequest.findOne({ code });
        if (!request) {
            throw new HttpError(404, "Deletion request not found", "DELETION_REQUEST_NOT_FOUND");
        }
        res.json({
            confirmationCode: request.code,
            status: request.status,
            requestedAt: request.createdAt,
        });
    },
};
