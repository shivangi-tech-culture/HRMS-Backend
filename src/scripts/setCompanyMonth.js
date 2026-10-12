/**
 * Store the default company month on every company that does not have one yet.
 * monthStartDay 1 and monthEndDay 31 means the 1st through the last day of the month.
 * A company that already set its own dates is left as it is.
 *
 * Run: node src/scripts/setCompanyMonth.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Company = require("../models/Company");

(async () => {
  await connectDB();
  const before = await Company.find().select("companyCode monthStartDay monthEndDay").lean();
  const missing = before.filter((row) => row.monthStartDay == null || row.monthEndDay == null).length;
  const result = await Company.collection.updateMany(
    { $or: [{ monthStartDay: { $exists: false } }, { monthStartDay: null }, { monthEndDay: { $exists: false } }, { monthEndDay: null }] },
    [
      {
        $set: {
          monthStartDay: { $ifNull: ["$monthStartDay", 1] },
          monthEndDay: {
            $cond: [
              { $gt: [{ $ifNull: ["$monthStartDay", 1] }, 1] },
              { $subtract: [{ $ifNull: ["$monthStartDay", 1] }, 1] },
              31,
            ],
          },
        },
      },
    ]
  );
  const rows = await Company.find().select("companyName companyCode monthStartDay monthEndDay").sort({ companyName: 1 }).lean();
  for (const row of rows) {
    console.log(`${row.companyCode}  ${row.companyName}  start ${row.monthStartDay}  end ${row.monthEndDay}`);
  }
  console.log(`${rows.length} companies. ${result.modifiedCount} updated. ${missing} were missing a month date.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
