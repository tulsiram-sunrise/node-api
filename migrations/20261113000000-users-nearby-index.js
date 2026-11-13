// B14 (PLAN 6.7): replace the plain location index with one that also covers
// the nearby filters, so $geoNear reads only discoverable users of the level.
// Must match the index definitions in api/v1/models/user.js.
//
// Builds the new index before dropping the old one, so nearby search always has
// a geo index. Code that calls $geoNear without `key` fails while both exist;
// v2.0.0 passes `key: "location"`. See docs/RELEASE.md step 4.
const OLD = { key: { location: "2dsphere" }, name: "location_2dsphere" };
const NEW = {
    key: { location: "2dsphere", discoverable: 1, level: 1 },
    name: "location_2dsphere_discoverable_1_level_1",
};

const dropIfPresent = (coll, name) =>
    coll.dropIndex(name).catch((err) => {
        if (err.codeName !== "IndexNotFound" && err.codeName !== "NamespaceNotFound") throw err;
    });

module.exports = {
    async up(db) {
        const users = db.collection("users");
        await users.createIndexes([NEW]);
        await dropIfPresent(users, OLD.name);
    },

    async down(db) {
        const users = db.collection("users");
        await users.createIndexes([OLD]);
        await dropIfPresent(users, NEW.name);
    },
};
