/**
 * Upsert Attendance reason masters (no wipe).
 * Run: node src/scripts/seedAttendanceReasonMasters.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { ensureAttendanceReasonMasters } = require("../utils/attendanceMasters");
const { DEFAULT_COMPANY } = require("../utils/companyScope");
const { ATTENDANCE_DROPDOWNS } = require("../config/generalInfoMasters");

(async () => {
  await connectDB();
  const created = await ensureAttendanceReasonMasters(DEFAULT_COMPANY);
  console.log(`Company: ${DEFAULT_COMPANY}`);
  console.log("regularizationReason:", ATTENDANCE_DROPDOWNS.regularizationReason.join(" | "));
  console.log("markAttendanceReason:", ATTENDANCE_DROPDOWNS.markAttendanceReason.join(" | "));
  console.log(`Created ${created} new master row(s) (existing skipped)`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
