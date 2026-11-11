const { User } = require("../models/user");
const HttpError = require("../../../lib/httpError");
const { milesToMeters, metersToMiles, toPoint } = require("../../../lib/geo");

const DEFAULT_NEARBY_MILES = 10;
const updateOptions = { returnDocument: "after", runValidators: true };

const userNotFound = () => new HttpError(404, "User not found", "USER_NOT_FOUND");

async function updateMe(req, update) {
    const user = await User.findByIdAndUpdate(req.auth.sub, { $set: update }, updateOptions);
    if (!user) throw userNotFound();
    return user;
}

module.exports = {
    getMe: async (req, res) => {
        const user = await User.findById(req.auth.sub);
        if (!user) throw userNotFound();
        res.json(user);
    },

    updateLevel: async (req, res) => {
        res.json(await updateMe(req, { level: req.body.level }));
    },

    updateLocation: async (req, res) => {
        res.json(await updateMe(req, { location: toPoint(req.body.location) }));
    },

    updateSetting: async (req, res) => {
        res.json(await updateMe(req, { setting: req.body }));
    },

    deleteMe: async (req, res) => {
        const result = await User.deleteOne({ _id: req.auth.sub });
        if (result.deletedCount === 0) throw userNotFound();
        res.status(204).end();
    },

    /**
     * Users near the caller. Exact positions are never returned; distance is
     * rounded up to whole miles to limit trilateration.
     */
    nearby: async (req, res) => {
        const { distance, level, limit } = req.validated.query;

        const me = await User.findById(req.auth.sub).select("location setting");
        if (!me) throw userNotFound();
        if (!me.location?.coordinates) {
            throw new HttpError(409, "Set your location first", "LOCATION_REQUIRED");
        }

        const radiusMiles = distance ?? me.setting?.distance ?? DEFAULT_NEARBY_MILES;
        // Aggregation filters are not cast by Mongoose, so use the ObjectId as-is.
        const query = { _id: { $ne: me._id } };
        if (level) query.level = level;

        const results = await User.aggregate([
            {
                $geoNear: {
                    near: me.location.toObject(),
                    distanceField: "distance",
                    maxDistance: milesToMeters(radiusMiles),
                    spherical: true,
                    query,
                },
            },
            { $limit: limit },
            { $project: { _id: 1, name: 1, profilePic: 1, level: 1, distance: 1 } },
        ]);

        res.json({
            radiusMiles,
            count: results.length,
            users: results.map((u) => ({
                id: String(u._id),
                name: u.name,
                profilePic: u.profilePic,
                level: u.level,
                distanceMiles: Math.max(1, Math.ceil(metersToMiles(u.distance))),
            })),
        });
    },
};
