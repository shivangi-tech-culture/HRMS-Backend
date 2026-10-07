/**
 * One-time fix for activity logs written before companyIds was stored.
 * Copies the employee's current official.companyIds (+ company names) onto
 * every log that has no companyIds, so GET /api/employees/activity?companyId= finds them.
 * Safe to run again — only touches logs with empty companyIds.
 *
 * Run: npm run backfill:activity
 */
require("dotenv").config();
const connectDB = require("../config/db");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const Company = require("../models/Company");

(async () => {
  await connectDB();

  const employeeIds = await ActivityLog.distinct("employee.id", {
    $or: [{ companyIds: { $exists: false } }, { companyIds: { $size: 0 } }],
  });
  const users = await User.find({ _id: { $in: employeeIds } })
    .select("official.companyIds")
    .lean();
  const companies = await Company.find().select("companyName").lean();
  const nameById = new Map(companies.map((c) => [String(c._id), c.companyName]));

  let updated = 0;
  for (const user of users) {
    const ids = user.official?.companyIds || [];
    if (!ids.length) continue;
    const names = ids.map((id) => nameById.get(String(id))).filter(Boolean).join(", ");
    const result = await ActivityLog.updateMany(
      {
        "employee.id": user._id,
        $or: [{ companyIds: { $exists: false } }, { companyIds: { $size: 0 } }],
      },
      { $set: { companyIds: ids, company: names, "employee.company": names } }
    );
    updated += result.modifiedCount;
  }

  console.log(`Activity logs updated: ${updated} (employees: ${users.length})`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
