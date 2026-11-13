// B11 (PLAN 6.5): convert v1 free-text preferred times ({ day, timing }) to
// comparable ranges ({ day, start: "HH:mm", end: "HH:mm" }).
//
// Entries that can't be read unambiguously ("6-8", "after work") are DROPPED.
// Run `npm run db:preview-preferred-time` first to see exactly what will be
// converted and dropped (docs/RELEASE.md step 4). `down` turns ranges back into
// "HH:mm-HH:mm" timing strings, but dropped entries can't be restored, so take
// the backup first (B15).
const { scanLegacy, report } = require("../scripts/lib/preferredTime");

const BATCH = 500;

module.exports = {
    async up(db) {
        const users = db.collection("users");
        let ops = [];
        const flush = async () => {
            if (ops.length) await users.bulkWrite(ops, { ordered: false });
            ops = [];
        };

        const stats = await scanLegacy(db, async (user, { items }) => {
            ops.push({ updateOne: { filter: { _id: user._id }, update: { $set: { "setting.preferredTime": items } } } });
            if (ops.length >= BATCH) await flush();
        });
        await flush();
        process.stdout.write(`${report(stats)}\n`);
    },

    async down(db) {
        const users = db.collection("users");
        const cursor = users.find({ "setting.preferredTime.start": { $exists: true } }, { projection: { setting: 1 } });
        let ops = [];
        for await (const user of cursor) {
            const items = user.setting.preferredTime.map(({ day, start, end }) => ({ day, timing: `${start}-${end}` }));
            ops.push({
                updateOne: {
                    filter: { _id: user._id },
                    update: { $set: { "setting.preferredTime": items }, $unset: { "setting.timeZone": "" } },
                },
            });
            if (ops.length >= BATCH) {
                await users.bulkWrite(ops, { ordered: false });
                ops = [];
            }
        }
        if (ops.length) await users.bulkWrite(ops, { ordered: false });
    },
};
