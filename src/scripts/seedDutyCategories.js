/**
 * On Tour and On Duty category masters only.
 * Upserts these names. Does not clear other masters, users, roles, or companies.
 *
 * On Tour  (GET /api/masters?type=onTourCategory)
 *   Up Country, Local, Intrastate, International
 * On Duty  (GET /api/masters?type=onDutyCategory)
 *   Client Site, Bank Work, Field Visit, Office Duty
 *
 * Run alone:
 *   npm run seed:on-tour
 *   npm run seed:on-duty
 * Both are also included in npm run seed and npm run seed:masters.
 */
const { getModel, COLLECTION_BY_TYPE } = require("../models/Master");
const { ATTENDANCE_DROPDOWNS } = require("../config/generalInfoMasters");

const TYPES = {
  onTour: "onTourCategory",
  onDuty: "onDutyCategory",
};

const seedDutyCategories = async (which) => {
  const key = String(which || "").trim();
  const types = key ? [TYPES[key]] : Object.values(TYPES);
  if (types.some((type) => !type)) {
    throw new Error("Pass onTour or onDuty");
  }

  let count = 0;
  for (const type of types) {
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
  return { count, types };
};

module.exports = { seedDutyCategories };

if (require.main === module) {
  require("dotenv").config();
  const connectDB = require("../config/db");
  const which = process.argv[2];
  (async () => {
    await connectDB();
    const result = await seedDutyCategories(which);
    console.log(
      `\nSeeded ${result.count} ${result.types.join(", ")} rows. Other masters were not changed.`
    );
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
