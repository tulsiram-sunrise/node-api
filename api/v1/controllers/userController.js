const jwt = require("jsonwebtoken");
const config = require("config");

var signToken = function(auth) {
    return jwt.sign(
        {
            sub: auth.id,
            iss: 'NodeApi'
        },
        config.get("JWTPrivateKey"),
        { expiresIn: '1d' }
    );
};

module.exports = {
    generateToken: function(req, res, next) {
        req.token = signToken(req.user);
        next();
    },

    sendToken: function(req, res) {
        res.setHeader("x-auth-token", req.token);
        res.status(200).send(req.user);
    },

    login: (req, res, next) => {
        if (!req.user) {
            return res.send(401, "User Not Authenticated");
        }
        next();
    },
};
