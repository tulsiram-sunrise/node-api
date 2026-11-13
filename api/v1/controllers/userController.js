const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { User } = require("../models/user");
const HttpError = require("../../../lib/httpError");
const cursors = require("../../../lib/cursor");
const { milesToMeters, metersToMiles, toPoint } = require("../../../lib/geo");
const { securityEvent } = require("../../../lib/securityLog");
const { overlapSlots } = require("../../../lib/availability");

const DEFAULT_NEARBY_MILES = 10;
const NEARBY_CURSOR = "nearby";
const updateOptions = { returnDocument: "after", runValidators: true };

const userNotFound = () => new HttpError(404, "User not found", "USER_NOT_FOUND");

/**
 * Nearby search context a cursor is bound to. If any of it changes between
 * pages (another caller, the caller moved, different radius or level), the
 * distances or filters no longer line up, so the cursor is rejected.
 */
const nearbyContext = (sub, coordinates, radiusMiles, level, matchKey) => ({
    sub: String(sub),
    at: [...coordinates],
    r: radiusMiles,
    l: level ?? null,
    // With matchTimes (B16): a digest of the caller's slots and zone, so editing
    // them between pages invalidates the cursor.
    t: matchKey ?? null,
});

const availabilityKey = (setting) =>
    crypto
        .createHash("sha256")
        .update(JSON.stringify([setting.timeZone, setting.preferredTime.map(({ day, start, end }) => [day, start, end])]))
        .digest("base64url")
        .slice(0, 16);

function readNearbyCursor(cursor, context) {
    const payload = cursors.open(cursor, NEARBY_CURSOR);
    const valid =
        payload &&
        JSON.stringify(payload.ctx) === JSON.stringify(context) &&
        typeof payload.d === "number" &&
        mongoose.isObjectIdOrHexString(payload.id);
    if (!valid) {
        throw new HttpError(400, "Invalid or outdated cursor; start the search again", "INVALID_CURSOR");
    }
    return { distance: payload.d, id: new mongoose.Types.ObjectId(String(payload.id)) };
}

const NEARBY_PROJECTION = { $project: { _id: 1, name: 1, profilePic: 1, level: 1, distance: 1 } };

// Page order: distance, then _id. ObjectId hex strings sort the same way as the ObjectIds.
const byDistanceThenId = (a, b) => a.distance - b.distance || String(a._id).localeCompare(String(b._id));

/**
 * One page of nearby users ordered by (distance, _id), starting after `after`.
 *
 * $geoNear streams results in distance order, so `$limit` stops the scan early.
 * A blocking `$sort` would read every user in the radius on every page. Users
 * at exactly the same distance come back in no fixed order, which only matters
 * when such a group straddles the page edge. In that case the whole group is
 * fetched separately (a narrow distance band) and ordered by _id, so the cursor
 * never skips or repeats anyone.
 */
async function nearbyPage(geoNear, after, limit, projection = NEARBY_PROJECTION) {
    // minDistance is inclusive, so also skip users at the cursor's distance already returned.
    const afterCursor = after
        ? [
              {
                  $match: {
                      $or: [{ distance: { $gt: after.distance } }, { distance: after.distance, _id: { $gt: after.id } }],
                  },
              },
          ]
        : [];
    const run = (geo, stages) => User.aggregate([{ $geoNear: geo }, ...afterCursor, ...stages, projection]);

    // One extra row tells us whether another page exists.
    const rows = await run(after ? { ...geoNear, minDistance: after.distance } : geoNear, [{ $limit: limit + 1 }]);
    if (rows.length <= limit) return { page: rows.sort(byDistanceThenId), hasMore: false };

    const edge = rows[limit - 1].distance;
    if (rows[limit].distance !== edge) {
        return { page: rows.slice(0, limit).sort(byDistanceThenId), hasMore: true };
    }

    const tied = await run({ ...geoNear, minDistance: edge, maxDistance: edge + 1 }, [
        { $match: { distance: edge } },
        { $sort: { _id: 1 } },
        { $limit: limit },
    ]);
    const closer = rows.filter((r) => r.distance < edge).sort(byDistanceThenId);
    return { page: [...closer, ...tied].slice(0, limit), hasMore: true };
}

// Availability matching (B16): candidates are scanned in distance order in
// batches and filtered in code, because each has its own time zone. The scan is
// capped per request, so a page can hold fewer than `limit` users while
// nextCursor still points further out.
const MATCH_BATCH = 100;
const MATCH_MAX_SCAN = 1000;
const MATCH_PROJECTION = {
    $project: { ...NEARBY_PROJECTION.$project, "setting.preferredTime": 1, "setting.timeZone": 1 },
};

/**
 * @returns {Promise<{ page: object[], hasMore: boolean, last: object | undefined }>}
 *   `last` is the position the next page continues after.
 */
async function matchingPage(geoNear, after, limit, mine, now) {
    const page = [];
    let position = after;
    let lastRow;
    let scanned = 0;
    for (;;) {
        const { page: batch, hasMore } = await nearbyPage(geoNear, position, MATCH_BATCH, MATCH_PROJECTION);
        for (const row of batch) {
            scanned += 1;
            lastRow = row;
            const theirs = { slots: row.setting?.preferredTime, timeZone: row.setting?.timeZone ?? mine.timeZone };
            const overlap = overlapSlots(mine, theirs, now);
            if (!overlap.length) continue;
            if (page.length === limit) return { page, hasMore: true, last: page.at(-1) };
            page.push({ ...row, overlapSlots: overlap });
        }
        if (!hasMore) return { page, hasMore: false, last: page.at(-1) };
        if (scanned >= MATCH_MAX_SCAN) return { page, hasMore: true, last: lastRow };
        position = { distance: lastRow.distance, id: lastRow._id };
    }
}

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

    /** Edit name, photo (B5) and country (B12). `null` removes the photo or country. */
    updateProfile: async (req, res) => {
        const $set = {};
        const $unset = {};
        if (req.body.name !== undefined) $set.name = req.body.name;
        for (const field of ["profilePic", "countryCode"]) {
            if (req.body[field] === null) $unset[field] = 1;
            else if (req.body[field] !== undefined) $set[field] = req.body[field];
        }

        const user = await User.findByIdAndUpdate(req.auth.sub, { $set, $unset }, updateOptions);
        if (!user) throw userNotFound();
        securityEvent(req, "user.profile_updated", { userId: String(user._id), fields: Object.keys(req.body) });
        res.json(user);
    },

    updateLevel: async (req, res) => {
        res.json(await updateMe(req, { level: req.body.level }));
    },

    /** Opt in or out of nearby search (B17); opting in records consent time. */
    updateDiscoverable: async (req, res) => {
        const { discoverable } = req.body;
        const user = await User.findByIdAndUpdate(
            req.auth.sub,
            discoverable
                ? { $set: { discoverable: true, discoverableSince: new Date() } }
                : { $set: { discoverable: false }, $unset: { discoverableSince: 1 } },
            updateOptions
        );
        if (!user) throw userNotFound();
        securityEvent(req, "user.discoverable_changed", { userId: String(user._id), discoverable });
        res.json(user);
    },

    updateLocation: async (req, res) => {
        res.json(await updateMe(req, { location: toPoint(req.body.location) }));
    },

    /**
     * Field by field, so a client that omits timeZone (older app versions, B11)
     * doesn't wipe the zone stored by a newer one.
     */
    updateSetting: async (req, res) => {
        const update = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [`setting.${key}`, value]));
        res.json(await updateMe(req, update));
    },

    deleteMe: async (req, res) => {
        const result = await User.deleteOne({ _id: req.auth.sub });
        if (result.deletedCount === 0) throw userNotFound();
        securityEvent(req, "user.deleted", { userId: String(req.auth.sub), via: "self" });
        res.status(204).end();
    },

    /**
     * Users near the caller, closest first, with cursor pagination (B7).
     * Exact positions are never returned; distance is rounded up to whole miles
     * to limit trilateration. The cursor holds the exact distance of the last
     * result, so it is encrypted (lib/cursor.js).
     */
    nearby: async (req, res) => {
        const { distance, level, limit, cursor, matchTimes } = req.validated.query;

        const me = await User.findById(req.auth.sub).select("location setting");
        if (!me) throw userNotFound();
        if (!me.location?.coordinates) {
            throw new HttpError(409, "Set your location first", "LOCATION_REQUIRED");
        }

        const radiusMiles = distance ?? me.setting?.distance ?? DEFAULT_NEARBY_MILES;
        // Aggregation filters are not cast by Mongoose, so use the ObjectId as-is.
        const query = { _id: { $ne: me._id }, discoverable: true };
        if (level) query.level = level;

        let mine;
        if (matchTimes) {
            const setting = me.setting?.toObject?.() ?? {};
            if (!setting.preferredTime?.length || !setting.timeZone) {
                throw new HttpError(409, "Set your preferred times and time zone first", "AVAILABILITY_REQUIRED");
            }
            mine = { slots: setting.preferredTime, timeZone: setting.timeZone };
            query["setting.preferredTime.0"] = { $exists: true };
        }

        const matchKey = matchTimes ? availabilityKey(me.setting) : null;
        const context = nearbyContext(me._id, me.location.coordinates, radiusMiles, level, matchKey);
        const after = cursor ? readNearbyCursor(cursor, context) : null;

        const geoNear = {
            near: me.location.toObject(),
            distanceField: "distance",
            maxDistance: milesToMeters(radiusMiles),
            spherical: true,
            // Name the geo field: $geoNear refuses to guess while a migration
            // briefly has two 2dsphere indexes on users (B14).
            key: "location",
            query,
        };
        const { page, hasMore, last } = matchTimes
            ? await matchingPage(geoNear, after, limit, mine, new Date())
            : await nearbyPage(geoNear, after, limit).then((r) => ({ ...r, last: r.page.at(-1) }));
        const nextCursor = hasMore
            ? cursors.seal({ ctx: context, d: last.distance, id: String(last._id) }, NEARBY_CURSOR)
            : null;

        res.json({
            radiusMiles,
            count: page.length,
            nextCursor,
            users: page.map((u) => ({
                id: String(u._id),
                name: u.name,
                profilePic: u.profilePic,
                level: u.level,
                distanceMiles: Math.max(1, Math.ceil(metersToMiles(u.distance))),
                // Shared availability in the caller's own time zone (B16).
                ...(matchTimes ? { overlapSlots: u.overlapSlots } : {}),
            })),
        });
    },
};
