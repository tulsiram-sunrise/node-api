const mongoose = require("mongoose");

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
        preferredTime: [
            new mongoose.Schema(
                { day: { type: String, enum: DAYS }, timing: String },
                { _id: false }
            ),
        ],
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
        currentCountryCode: { type: mongoose.Schema.Types.ObjectId, ref: "ReferenceCode" },
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
                return ret;
            },
        },
    }
);

// One account per provider identity; enforced by the database, not app code.
userSchema.index({ "facebook.id": 1 }, { unique: true, sparse: true });
userSchema.index({ "google.id": 1 }, { unique: true, sparse: true });
userSchema.index({ location: "2dsphere" });

/**
 * Atomically find or create the user for a verified social identity.
 * @param {{provider: string, providerId: string, email?: string, name?: string, profilePic?: string}} identity
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
            }
        );

    try {
        return await run();
    } catch (err) {
        // Two concurrent first logins: the loser hits the unique index, so re-read.
        if (err.code === DUPLICATE_KEY) return run();
        throw err;
    }
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = { User, LEVELS, DAYS };
