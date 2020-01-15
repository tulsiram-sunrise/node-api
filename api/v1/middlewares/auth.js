const expressJwt = require("express-jwt");
const config = require("config");

module.exports = expressJwt({
    secret: config.get("JWTPrivateKey"),
    requestProperty: "auth",
    getToken: function(req) {
        if (req.headers["x-auth-token"]) {
            return req.headers["x-auth-token"];
        }
        return null;
    }
});
