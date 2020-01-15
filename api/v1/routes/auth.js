const express = require("express");
const router = express.Router();
const UserController = require("../controllers/userController");
const passport = require("passport");

router.post(
    "/facebook",
    passport.authenticate("facebook-token", { session: false }),
    UserController.login,
    UserController.generateToken,
    UserController.sendToken
);

router.post(
    "/google",
    passport.authenticate("google-token", { session: false, scope: 
        [ 'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/plus.me', ] }),
    UserController.login,
    UserController.generateToken,
    UserController.sendToken
);

module.exports = router;
