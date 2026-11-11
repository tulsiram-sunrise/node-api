/**
 * An error whose message is safe to return to the client.
 */
class HttpError extends Error {
    constructor(status, message, code = undefined, details = undefined) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

module.exports = HttpError;
