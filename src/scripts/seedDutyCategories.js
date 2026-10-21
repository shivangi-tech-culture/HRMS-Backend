/**
 * On Tour and On Duty category masters only.
 * Upserts these names. Does not clear other masters, users, roles, or companies.
 *
 * On Tour  (GET /api/masters?type=onTourCategory)
 *   Up Country, Local, Intrastate, International
 * On Duty  (GET /api/masters?type=onDutyCategory)
 *   Client Site, Bank Work, Field Visit, Office Duty
 *
 * Run: npm run seed:duty-categories
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { getModel, COLLECTION_BY_TYPE } = require("../models/Master");
const { ATTENDANCE_DROPDOWNS } = require("../config/generalInfoMasters");

const TYPES = ["onTourCategory", "onDutyCategory"];

(async () => {
  await connectDB();

  let count = 0;
  for (const type of TYPES) {
    const Model = getModel(type);
    for (const name of ATTENDANCE_DROPDOWNS[type]) {
      await Model.updateOne(
        { name },
        { $set: { name, code: "", company: "", status: "Active" } },
        { upsert: true }
      );
      count += 1;
      console.log(`${type} (${COLLECTION_BY_TYPE[type]}): ${name}`);
    }
  }

  console.log(`\nDuty categories seeded: ${count} rows. Other masters were not changed.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
