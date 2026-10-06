/**
 * Migrate official.reportingHead1 / reportingHead2 from strings → User _id.
 *
 * Old values were email, employee code, name or an _id string.
 * Each is matched (case-insensitive) to a Reporting Manager; unmatched / empty → null.
 * Safe to re-run: ObjectId values are left as they are.
 *
 * Run: npm run migrate:reporting-heads
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const { MANAGER_ROLES } = require("../utils/teamScope");

const KEYS = ["reportingHead1", "reportingHead2"];

const run = async () => {
  await connectDB();
  const col = User.collection;

  const managers = await col
    .find({ role: { $in: MANAGER_ROLES } })
    .project({ name: 1, "official.officialEmail": 1, "official.employeeCode": 1 })
    .toArray();

  const idByToken = new Map();
  for (const m of managers) {
    for (const token of [
      String(m._id),
      m.official?.officialEmail,
      m.official?.employeeCode,
      m.name,
    ]) {
      const key = String(token || "").trim().toLowerCase();
      if (key && !idByToken.has(key)) idByToken.set(key, m._id);
    }
  }

  const users = await col
    .find({
      $or: KEYS.map((k) => ({ [`official.${k}`]: { $type: "string" } })),
    })
    .project({ name: 1, "official.reportingHead1": 1, "official.reportingHead2": 1 })
    .toArray();

  let converted = 0;
  let cleared = 0;
  for (const u of users) {
    const set = {};
    for (const key of KEYS) {
      const raw = u.official?.[key];
      if (typeof raw !== "string") continue;
      const id = idByToken.get(raw.trim().toLowerCase()) || null;
      set[`official.${key}`] = id;
      if (id) {
        converted += 1;
        console.log(`${u.name}: ${key} "${raw}" → ${id}`);
      } else {
        if (raw.trim()) {
          console.log(`${u.name}: ${key} "${raw}" → null (no Reporting Manager matched)`);
        }
        cleared += 1;
      }
    }
    await col.updateOne({ _id: u._id }, { $set: set });
  }

  console.log(
    `\nDone. Users touched: ${users.length}, heads converted: ${converted}, cleared: ${cleared}`
  );
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
