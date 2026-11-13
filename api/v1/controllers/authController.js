const crypto = require("node:crypto");
const config = require("config");
const { User } = require("../models/user");
const { DeletionRequest } = require("../models/deletionRequest");
const oauth = require("../services/oauth");
const tokens = require("../../../lib/tokens");
const HttpError = require("../../../lib/httpError");
const { securityEvent } = require("../../../lib/securityLog");

/** Verify the provider token, then find or create the user and issue our JWT. */
async function login(req, res, provider, verify) {
    let identity;
    try {
        identity = await verify();
    } catch (err) {
        // Only rejected tokens are security events; 501/502 are config and outage conditions.
        if (err instanceof HttpError && err.status === 401) {
            securityEvent(req, "auth.login_failed", { provider, reason: err.code });
        }
        throw err;
    }

    const { user, created } = await User.upsertOAuthUser(identity);
    const token = tokens.sign(user);
    securityEvent(req, "auth.login", { userId: String(user._id), provider, newUser: created });
    res.setHeader("x-auth-token", token);
    res.status(200).json(user);
}

function publicBaseUrl(req) {
    const configured = config.get("publicUrl");
    return (configured || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

module.exports = {
    facebook: (req, res) => login(req, res, "facebook", () => oauth.verifyFacebookToken(req.body.access_token)),

    google: (req, res) => login(req, res, "google", () => oauth.verifyGoogleToken(req.body.id_token)),

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

        // No user identifiers: the user asked for erasure, and the code is enough to trace it.
        securityEvent(req, "user.deleted", {
            via: "facebook_data_deletion",
            confirmationCode: code,
            userFound: Boolean(deleted),
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
