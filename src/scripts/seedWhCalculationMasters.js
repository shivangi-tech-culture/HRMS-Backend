/**
 * Seed Masters → whCalculation dropdown (Work Timings UI).
 * Options: Shift Based | Fixed Hours | Flexible
 * Run: npm run seed:wh-calculation
 */
require("dotenv").config();
const connectDB = require("../config/db");
const { getModel } = require("../models/Master");
const { DEFAULT_COMPANY } = require("../utils/companyScope");

const OPTIONS = ["Shift Based", "Fixed Hours", "Flexible"];

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const run = async () => {
  await connectDB();
  const company = String(
    process.env.COMPANY || process.env.DEFAULT_COMPANY || DEFAULT_COMPANY
  ).trim();
  const Model = getModel("whCalculation");

  console.log(`Seeding master whCalculation for → ${company}`);

  for (const name of OPTIONS) {
    const existing = await Model.findOne({
      company: new RegExp(`^${escapeRegex(company)}$`, "i"),
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    });
    if (existing) {
      existing.status = "Active";
      await existing.save();
      console.log(`  exists → ${name}`);
    } else {
      await Model.create({ name, company, status: "Active" });
      console.log(`  created → ${name}`);
    }
  }

  const total = await Model.countDocuments({
    company: new RegExp(`^${escapeRegex(company)}$`, "i"),
  });
  console.log(`Done. whCalculation masters: ${total}`);
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
