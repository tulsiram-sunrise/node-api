// v2.0.0: unique provider-ID indexes and the geo index on users.
// Must match the index definitions in api/v1/models/user.js.
const { findDuplicateProviderIds } = require("../scripts/lib/duplicates");

const INDEXES = [
    { key: { "facebook.id": 1 }, name: "facebook.id_1", unique: true, sparse: true },
    { key: { "google.id": 1 }, name: "google.id_1", unique: true, sparse: true },
    { key: { location: "2dsphere" }, name: "location_2dsphere" },
];

module.exports = {
    async up(db) {
        // Fail with an actionable message instead of a bare E11000.
        const dupes = await findDuplicateProviderIds(db);
        if (dupes.length) {
            const summary = dupes.map((d) => `${d.field}=${d.value} (${d.count} users)`).join("; ");
            throw new Error(
                `Duplicate provider IDs must be resolved first (see docs/RELEASE.md step 3): ${summary}`
            );
        }
        await db.collection("users").createIndexes(INDEXES);
    },

    async down(db) {
        const users = db.collection("users");
        for (const { name } of INDEXES) {
            await users.dropIndex(name).catch((err) => {
                if (err.codeName !== "IndexNotFound") throw err;
            });
        }
    },
};
