/**
 * Seed the daily break balance (30 minutes) if it is missing.
 * Run: node src/scripts/seedBreakPolicies.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { seedBreakPolicies } = require("../utils/breakPolicy");

connectDB()
  .then(async () => {
    const result = await seedBreakPolicies();
    console.log(`Break policy ready. Added ${result.added} rule(s).`);
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
