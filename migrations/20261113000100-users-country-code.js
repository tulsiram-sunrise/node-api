// B12 (PLAN 6.7): v1 stored currentCountryCode as an ObjectId into a
// ReferenceCode model this service never had. It is replaced by countryCode
// (ISO 3166-1 alpha-2, set by users through PATCH /users/me).
//
// The old IDs can't be mapped without the referencecodes collection. If that
// collection exists, the IDs might be convertible, so this migration stops and
// asks for a decision instead of discarding them (docs/RELEASE.md step 4).
// Otherwise the IDs point at nothing and are removed. That can't be undone,
// so `down` is a no-op.
const LEGACY_FIELD = "currentCountryCode";
const REFERENCE_COLLECTION = "referencecodes";

module.exports = {
    async up(db) {
        const refs = await db.listCollections({ name: REFERENCE_COLLECTION }, { nameOnly: true }).toArray();
        if (refs.length) {
            const withValue = await db.collection("users").countDocuments({ [LEGACY_FIELD]: { $exists: true } });
            throw new Error(
                `${REFERENCE_COLLECTION} exists, so ${withValue} user ${LEGACY_FIELD} value(s) may be mappable to ISO codes. ` +
                    "Map them to countryCode or drop that collection first (see docs/RELEASE.md step 4)."
            );
        }
        await db.collection("users").updateMany({ [LEGACY_FIELD]: { $exists: true } }, { $unset: { [LEGACY_FIELD]: "" } });
    },

    async down() {
        // The removed IDs referenced nothing; there is nothing to restore.
    },
};
