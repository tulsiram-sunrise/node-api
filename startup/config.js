const config = require("config");
const passport = require('passport');
const FacebookTokenStrategy = require('passport-facebook-token');
const GoogleTokenStrategy = require('passport-google-plus-token');
const { User } = require('../api/v1/models/user');

module.exports = () => {
    if (!config.get("JWTPrivateKey")) {
        console.log('JWTPrivateKey is not defined.');
        throw new Error("FATAL ERROR: JWTPrivateKey is not defined.");
    }

    const fci = config.get('FacebookClientId');
    const fcs = config.get('FacebookClientSecret');

    if (!fci || !fcs) {
        console.log('facebook client id or/and secret not properly set');
        throw new Error("FATAL ERROR: facebook client id or/and secret not properly set.");
    }

    const gci = config.get('GoogleClientId');
    const gcs = config.get('GoogleClientSecret');

    if (!gci || !gcs) {
        console.log('google client id or/and secret not properly set');
        throw new Error("FATAL ERROR: google client id or/and secret not properly set.");
    }

    // Facebook oAuth token strategy
    passport.use('facebook-token', new FacebookTokenStrategy(
        { clientID: fci, clientSecret: fcs, redirect_uri: 'http://localhost:5000/api/v1/auth/google/callback' },
        function (accessToken, refreshToken, profile, done) {
            User.upsertFbUser(accessToken, refreshToken, profile, function(err, user) {
                return done(err, user);
            });
        }
    ));

    // Google oAuth token strategy
    passport.use('google-token', new GoogleTokenStrategy(
        { clientID: gci, clientSecret: gcs, }, 
        async (accessToken, refreshToken, profile, done) => {
            User.upsertGoogleUser(accessToken, refreshToken, profile, function(err, user) {
                return done(err, user);
            })
        }
    ));
};
