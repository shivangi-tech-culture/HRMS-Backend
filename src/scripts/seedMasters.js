/**
 * Masters only — same rows as src/seed.js.
 * Clears master collections, then recreates every dropdown.
 * Does not touch users, roles, or companies.
 *
 * Run: npm run seed:masters
 */
require("dotenv").config();
const connectDB = require("../config/db");
const {
  getModel,
  clearAllMasterCollections,
  COLLECTION_BY_TYPE,
} = require("../models/Master");
const { buildMasterSeedRows } = require("../config/generalInfoMasters");

(async () => {
  await connectDB();

  await clearAllMasterCollections();
  console.log("Old masters cleared");

  const masters = buildMasterSeedRows();
  for (const row of masters) {
    const Model = getModel(row.type);
    await Model.create({
      name: row.name,
      company: "",
      status: "Active",
    });
    console.log(
      `Master → ${row.type} (${COLLECTION_BY_TYPE[row.type]}): ${row.name}`
    );
  }

  console.log(`\nMasters seeded: ${masters.length} rows. Users and roles were not changed.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
