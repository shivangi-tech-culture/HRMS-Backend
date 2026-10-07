/**
 * Masters only — same rows as src/seed.js.
 * Clears master collections, then recreates every dropdown.
 * Branch / shift rows are upserted by name instead (companies and users hold their _ids).
 * Does not touch users, roles, or companies.
 *
 * Run: npm run seed:masters
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { TYPES, getModel, COLLECTION_BY_TYPE } = require("../models/Master");
const { buildMasterSeedRows } = require("../config/generalInfoMasters");

const KEEP_IDS = ["branch", "shift"];

(async () => {
  await connectDB();

  await Promise.all(
    TYPES.filter((t) => !KEEP_IDS.includes(t)).map((t) => getModel(t).deleteMany({}))
  );
  console.log("Old masters cleared (branch / shift kept)");

  const masters = buildMasterSeedRows();
  for (const row of masters) {
    const Model = getModel(row.type);
    const doc = { name: row.name, code: row.code, company: "", status: "Active" };
    if (KEEP_IDS.includes(row.type)) {
      await Model.updateOne({ name: row.name }, { $set: doc }, { upsert: true });
    } else {
      await Model.create(doc);
    }
    console.log(
      `Master → ${row.type} (${COLLECTION_BY_TYPE[row.type]}): ${row.name}${row.code ? ` [${row.code}]` : ""}`
    );
  }

  console.log(`\nMasters seeded: ${masters.length} rows. Users and roles were not changed.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
