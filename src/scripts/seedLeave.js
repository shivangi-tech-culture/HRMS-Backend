/**
 * Add the default leave types and leave policies.
 * Skips rows that are already there. Does not delete anything.
 *
 * Run: npm run seed:leave
 * The API also runs this once when the server starts.
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { seedLeaveDefaults } = require("../utils/seedLeave");

(async () => {
  await connectDB();
  const result = await seedLeaveDefaults();
  console.log(
    `Leave defaults: ${result.typesAdded} common types added, ${result.policiesAdded} common policies added.`
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});