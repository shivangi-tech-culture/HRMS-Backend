/**
 * Holiday catalog for 2026 — India gazetted holidays.
 * Upserts by date. Does not delete holidays an admin already added.
 * Assigns each seeded day to every company (adds, does not replace).
 *
 * Run: npm run seed:holiday
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Holiday = require("../models/Holiday");
const Company = require("../models/Company");

/** Central gazetted list for 2026 (DoPT / NIEPVD). */
const HOLIDAYS_2026 = [
  { name: "Republic Day", date: "2026-01-26" },
  { name: "Holi", date: "2026-03-04" },
  { name: "Id-ul-Fitr", date: "2026-03-21" },
  { name: "Ram Navami", date: "2026-03-26" },
  { name: "Mahavir Jayanti", date: "2026-03-31" },
  { name: "Good Friday", date: "2026-04-03" },
  { name: "Buddha Purnima", date: "2026-05-01" },
  { name: "Id-ul-Zuha (Bakrid)", date: "2026-05-27" },
  { name: "Muharram", date: "2026-06-26" },
  { name: "Independence Day", date: "2026-08-15" },
  { name: "Milad-un-Nabi", date: "2026-08-26" },
  { name: "Janmashtami", date: "2026-09-04" },
  { name: "Mahatma Gandhi Jayanti", date: "2026-10-02" },
  { name: "Dussehra", date: "2026-10-20" },
  { name: "Diwali", date: "2026-11-08" },
  { name: "Guru Nanak Jayanti", date: "2026-11-24" },
  { name: "Christmas Day", date: "2026-12-25" },
];

(async () => {
  await connectDB();
  const companies = await Company.find().select("_id companyName").lean();
  const companyIds = companies.map((row) => row._id);

  for (const row of HOLIDAYS_2026) {
    await Holiday.updateOne(
      { date: row.date },
      {
        $set: { name: row.name, date: row.date, isActive: true },
        $setOnInsert: { description: "" },
        ...(companyIds.length ? { $addToSet: { companyIds: { $each: companyIds } } } : {}),
      },
      { upsert: true }
    );
    console.log(`Holiday: ${row.name} (${row.date})`);
  }

  console.log(
    `\nHolidays seeded: ${HOLIDAYS_2026.length} rows, assigned to ${companies.length} ${companies.length === 1 ? "company" : "companies"}.`
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
