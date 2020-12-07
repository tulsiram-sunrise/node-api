const mongoose = require("mongoose");
const Joi = require("joi");

const email = {
    type: String,
    match: /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
};

// User schema for database mongodb
const userSchema = new mongoose.Schema({
    provider: {
        type: String,
        enum: ['local', 'facebook', 'google'],
        required: true,
        select: false
    },
    email: email,
    facebook: {
        type: { id: String },
        select: false
    },
    google: {
        type: { id: String },
        select: false
    },
    name: {
        type: String
    },
    profilePic: {
        type: String
    },
    level: {
        type: String,
        default: "Beginner"
    },
    currentCountryCode: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReferenceCode"
    },
    setting: Object,
});

userSchema.statics.upsertFbUser = function(
    accessToken,
    refreshToken,
    profile,
    cb
) {
    var that = this;
    return this.findOne(
        {
            "facebook.id": profile.id
        },
        function(err, user) {
            // no user was found, lets create a new one
            if (!user) {
                var newUser = new that({
                    provider: 'facebook',
                    email: profile.emails[0].value,
                    facebook: { id: profile.id }
                });

                newUser.save(function(error, savedUser) {
                    if (error) {
                        console.log(error);
                    }
                    return cb(error, savedUser);
                });
            } else {
                return cb(err, user);
            }
        }
    );
};

userSchema.statics.upsertGoogleUser = function(
    accessToken,
    refreshToken,
    profile,
    cb
) {
    var that = this;
    return this.findOne(
        { "google.id": profile.id, },
        function(err, user) {
            // no user was found, lets create a new one
            if (!user) {
                var newUser = new that({
                    provider: 'google',
                    email: profile.emails[0].value,
                    google: { id: profile.id }
                });

                newUser.save(function(error, savedUser) {
                    if (error) {
                        console.log(error);
                    }
                    return cb(error, savedUser);
                });
            } else {
                return cb(err, user);
            }
        }
    )
}

const User = mongoose.model("User", userSchema);

const userLevelSchema = Joi.object().keys({
    level: Joi.string().required().valid(['Beginner', 'Intermediate', 'Advanced'])
});

const userLocationSchema = Joi.object().keys({
    location: Joi.object().keys({
        lat: Joi.number().required(),
        lng: Joi.number().required()
    }).required()
});

const userSettingSchema = Joi.object().keys({
    distance: Joi.number().required(),
    preferredTime: Joi.array().items(Joi.object().keys({
        day: Joi.string(),
        timing: Joi.string()
    }).with('day', 'timing').required()).required()
});

exports.User = User;
exports.levelSchema = userLevelSchema;
exports.locationSchema = userLocationSchema;
exports.settingSchema = userSettingSchema;
