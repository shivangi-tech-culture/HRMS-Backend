/**
 * Apply the finalized leave policy and remove the previous leave types.
 *
 * Adds: Casual Leave (CL), Earned Leave (EL), Comp Off (CO), Unpaid Leave (UL).
 * Removes: the old Quarterly Leave code (QL) by renaming it to CL, plus Sick, Annual, Maternity, Paternity, Bereavement.
 *
 * Run: npm run seed:leave
 * The API also runs this when the server starts.
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { seedLeaveDefaults } = require("../utils/seedLeave");

(async () => {
  await connectDB();
  const result = await seedLeaveDefaults();
  console.log(
    `Leave policy applied: ${result.typesAdded} types added, ${result.typesUpdated} types updated, ${result.typesRemoved} old types removed, ${result.pendingCancelled} pending requests cancelled, ${result.policiesAdded} policies added, ${result.policiesUpdated} policies updated.`
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
