// Facebook data-deletion records (B1): unique confirmation code + 365-day TTL.
// Must match api/v1/models/deletionRequest.js.
const INDEXES = [
    { key: { code: 1 }, name: "code_1", unique: true },
    { key: { createdAt: 1 }, name: "createdAt_1", expireAfterSeconds: 365 * 24 * 60 * 60 },
];

module.exports = {
    async up(db) {
        await db.collection("deletionrequests").createIndexes(INDEXES);
    },

    async down(db) {
        const coll = db.collection("deletionrequests");
        for (const { name } of INDEXES) {
            await coll.dropIndex(name).catch((err) => {
                if (!["IndexNotFound", "NamespaceNotFound"].includes(err.codeName)) throw err;
            });
        }
    },
};
