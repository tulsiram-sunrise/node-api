const jwt = require("jsonwebtoken");
const config = require("config");

const ALGORITHM = "HS256";

function jwtOptions() {
    return config.get("jwt");
}

function sign(user) {
    const { secret, expiresIn, issuer, audience } = jwtOptions();
    return jwt.sign({}, secret, {
        algorithm: ALGORITHM,
        subject: String(user._id ?? user.id),
        expiresIn,
        issuer,
        audience,
    });
}

function verify(token) {
    const { secret, issuer, audience } = jwtOptions();
    return jwt.verify(token, secret, {
        algorithms: [ALGORITHM],
        issuer,
        audience,
    });
}

module.exports = { sign, verify };
