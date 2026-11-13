const logger = require("./logger");

const MAX_USER_AGENT = 256;

/**
 * Security event log (GAP B4): answers "who signed in, from where, and what
 * changed" during an incident.
 *
 * Each event is one `info` log line with a stable `securityEvent` name, so the
 * log platform can filter them and keep them for 90 days (PLAN 6.1). Fields
 * are IDs and metadata only. Never pass tokens, emails, names or coordinates.
 *
 * Events:
 * - auth.login            { userId, provider, newUser }
 * - auth.login_failed     { provider, reason }
 * - user.profile_updated  { userId, fields }
 * - user.discoverable_changed { userId, discoverable }
 * - user.deleted          { userId, via: "self" } | { via: "facebook_data_deletion", confirmationCode, userFound }
 *
 * @param {{ id?: string, ip?: string, get?: (name: string) => string | undefined }} req
 * @param {string} event
 * @param {object} [fields]
 */
function securityEvent(req, event, fields = {}) {
    logger.info(`security: ${event}`, {
        securityEvent: event,
        ...fields,
        requestId: req.id,
        ip: req.ip,
        userAgent: req.get?.("user-agent")?.slice(0, MAX_USER_AGENT),
    });
}

module.exports = { securityEvent };
