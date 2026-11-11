/**
 * Find users sharing the same provider ID. These must be resolved before the
 * unique indexes on facebook.id / google.id can be built.
 *
 * @param {import("mongodb").Db} db
 * @returns {Promise<{ field: string, value: string, ids: unknown[], count: number }[]>}
 */
async function findDuplicateProviderIds(db) {
    const users = db.collection("users");
    const results = [];
    for (const field of ["facebook.id", "google.id"]) {
        const groups = await users
            .aggregate([
                { $match: { [field]: { $exists: true, $nin: [null, ""] } } },
                { $group: { _id: `$${field}`, ids: { $push: "$_id" }, count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } },
                { $sort: { count: -1 } },
            ])
            .toArray();
        for (const g of groups) results.push({ field, value: g._id, ids: g.ids, count: g.count });
    }
    return results;
}

module.exports = { findDuplicateProviderIds };
