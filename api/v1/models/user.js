const mongoose = require("mongoose");
const { COUNTRY_CODES } = require("../../../lib/countries");
const { START, END, isValidRange, formatTiming, canonicalTimeZone } = require("../../../lib/timeRange");

const PROVIDERS = ["facebook", "google"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DUPLICATE_KEY = 11000;

const pointSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ["Point"], required: true },
        coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    { _id: false }
);

const settingSchema = new mongoose.Schema(
    {
        distance: { type: Number, min: 1, max: 100 },
        // B11: comparable ranges in the user's own time zone (setting.timeZone).
        preferredTime: [
            new mongoose.Schema(
                {
                    day: { type: String, enum: DAYS, required: true },
                    start: { type: String, match: START, required: true },
                    end: {
                        type: String,
                        match: END,
                        required: true,
                        validate: {
                            validator(end) {
                                // `this` is the subdocument on save, but a Query on update validators.
                                const start = typeof this?.get === "function" ? this.get("start") : undefined;
                                return start === undefined || isValidRange({ start, end });
                            },
                            message: "end must be after start",
                        },
                    },
                },
                { _id: false }
            ),
        ],
        // IANA name, stored canonical (B11).
        timeZone: {
            type: String,
            validate: { validator: (tz) => canonicalTimeZone(tz) === tz, message: "unknown or non-canonical time zone" },
        },
    },
    { _id: false }
);

const userSchema = new mongoose.Schema(
    {
        provider: { type: String, enum: PROVIDERS, required: true, select: false },
        email: { type: String, lowercase: true, trim: true, maxlength: 254 },
        facebook: { id: { type: String, select: false } },
        google: { id: { type: String, select: false } },
        name: { type: String, trim: true, maxlength: 100 },
        profilePic: { type: String, maxlength: 2048 },
        level: { type: String, enum: LEVELS, default: "Beginner" },
        location: { type: pointSchema },
        // Opt-in (B17): only users who turned this on appear in nearby search.
        discoverable: { type: Boolean, default: false },
        // When the user last opted in; kept as a consent record.
        discoverableSince: { type: Date },
        // ISO 3166-1 alpha-2, set by the user (B12). Replaces v1 currentCountryCode.
        countryCode: { type: String, enum: COUNTRY_CODES },
        setting: { type: settingSchema },
    },
    {
        timestamps: true,
        toJSON: {
            versionKey: false,
            transform(doc, ret) {
                ret.id = String(ret._id);
                delete ret._id;
                delete ret.provider;
                delete ret.facebook;
                delete ret.google;
                if (ret.location?.coordinates) {
                    const [lng, lat] = ret.location.coordinates;
                    ret.location = { lat, lng };
                }
                // Deprecated (B11): "HH:mm-HH:mm" for app versions that still read `timing`.
                if (Array.isArray(ret.setting?.preferredTime)) {
                    ret.setting.preferredTime = ret.setting.preferredTime.map((t) => ({ ...t, timing: formatTiming(t) }));
                }
                return ret;
            },
        },
    }
);

// One account per provider identity; enforced by the database, not app code.
userSchema.index({ "facebook.id": 1 }, { unique: true, sparse: true });
userSchema.index({ "google.id": 1 }, { unique: true, sparse: true });
// Nearby search (B14): discoverable and level are filtered inside the index,
// so $geoNear reads only users that match. Replaces the plain location index.
userSchema.index({ location: "2dsphere", discoverable: 1, level: 1 });

/**
 * Atomically find or create the user for a verified social identity.
 * Provider name and photo are only copied on insert, so later edits made with
 * PATCH /users/me are not overwritten at the next login.
 * @param {{provider: string, providerId: string, email?: string, name?: string, profilePic?: string}} identity
 * @returns {Promise<{ user: object, created: boolean }>}
 */
userSchema.statics.upsertOAuthUser = async function (identity) {
    const { provider, providerId, email, name, profilePic } = identity;
    if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider ${provider}`);

    const filter = { [`${provider}.id`]: String(providerId) };
    const onInsert = { provider };
    if (email) onInsert.email = email;
    if (name) onInsert.name = name;
    if (profilePic) onInsert.profilePic = profilePic;

    const run = () =>
        this.findOneAndUpdate(
            filter,
            { $setOnInsert: onInsert },
            {
                upsert: true,
                returnDocument: "after",
                runValidators: true,
                setDefaultsOnInsert: true,
                includeResultMetadata: true,
            }
        );
    const unwrap = (result) => ({ user: result.value, created: !result.lastErrorObject?.updatedExisting });

    try {
        return unwrap(await run());
    } catch (err) {
        // Two concurrent first logins: the loser hits the unique index, so re-read.
        if (err.code === DUPLICATE_KEY) return unwrap(await run());
        throw err;
    }
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = { User, LEVELS, DAYS };
