/**
 * Re-sync master collections from UI catalog without wiping users/roles.
 * Run: node src/scripts/syncGeneralInfoMasters.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const {
  getModel,
  clearAllMasterCollections,
  COLLECTION_BY_TYPE,
} = require("../models/Master");
const { buildMasterSeedRows } = require("../config/generalInfoMasters");
const { DEFAULT_COMPANY } = require("../utils/companyScope");

(async () => {
  await connectDB();
  await clearAllMasterCollections();
  console.log("Cleared all master collections");

  const masters = buildMasterSeedRows();
  for (const m of masters) {
    const Model = getModel(m.type);
    const payload = { name: m.name, company: "", status: "Active" };
    await Model.create(payload);
    console.log(`Master → ${m.type} (${COLLECTION_BY_TYPE[m.type]}): ${m.name}`);
  }

  console.log(`\nSynced ${masters.length} master rows for ${DEFAULT_COMPANY}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
