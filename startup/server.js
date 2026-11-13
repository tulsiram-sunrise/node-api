/**
 * Apply HTTP server timeouts (GAP B10).
 *
 * - requestTimeout: max time to receive a whole request (headers + body), so a
 *   slow client can't hold a socket open by trickling bytes.
 * - headersTimeout: max time to receive the request headers (slowloris).
 * - keepAliveTimeout: how long an idle keep-alive socket stays open. It must be
 *   longer than the load balancer's idle timeout (60 s on AWS ALB / GCP), or the
 *   balancer may reuse a socket the server just closed and return a 502.
 *
 * Slow handlers are bounded separately: MongoDB queries by `maxTimeMS`
 * (startup/db.js) and provider calls by their own fetch timeout.
 *
 * @param {import("node:http").Server} server
 * @param {{ requestMs: number, headersMs: number, keepAliveMs: number }} timeouts
 */
function applyServerTimeouts(server, { requestMs, headersMs, keepAliveMs }) {
    server.requestTimeout = requestMs;
    server.headersTimeout = headersMs;
    server.keepAliveTimeout = keepAliveMs;
    return server;
}

module.exports = { applyServerTimeouts };
