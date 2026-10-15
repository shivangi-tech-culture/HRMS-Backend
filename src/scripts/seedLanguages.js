/**
 * Language master only — upserts the default language list.
 * Does not clear other masters, users, roles, or companies.
 * Custom languages already saved by an admin are left in place.
 *
 * Run: npm run seed:language
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { getModel, COLLECTION_BY_TYPE } = require("../models/Master");
const { UI_DROPDOWNS } = require("../config/generalInfoMasters");

(async () => {
  await connectDB();

  const Model = getModel("language");
  const entries = UI_DROPDOWNS.language;

  for (const entry of entries) {
    const { name, code = "" } = typeof entry === "string" ? { name: entry } : entry;
    await Model.updateOne(
      { name },
      { $set: { name, code, company: "", status: "Active" } },
      { upsert: true }
    );
    console.log(
      `Language (${COLLECTION_BY_TYPE.language}): ${name}${code ? ` [${code}]` : ""}`
    );
  }

  console.log(`\nLanguages seeded: ${entries.length} rows. Other masters were not changed.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
