/**
 * Verify Break module on Role docs + default catalog.
 * Run: node src/scripts/checkBreakPermissions.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const {
  permissionsForRole,
  findAction,
  countPermissions,
} = require("../config/permissions");

const NAMES = ["Super Admin", "Admin", "HR Manager", "Reporting Manager"];

const check = (label, p) => ({
  liveView: findAction(p, "Break", "Live Break Status", "view"),
  liveEdit: findAction(p, "Break", "Live Break Status", "edit"),
  histView: findAction(p, "Break", "Break History", "view"),
  histExport: findAction(p, "Break", "Break History", "export"),
  policyView: findAction(p, "Break", "Break Policy", "view"),
  policyCreate: findAction(p, "Break", "Break Policy", "create"),
  policyEdit: findAction(p, "Break", "Break Policy", "edit"),
  policyDelete: findAction(p, "Break", "Break Policy", "delete"),
});

(async () => {
  console.log("\n=== Catalog defaults (permissionsForRole) ===");
  for (const name of NAMES) {
    console.log(name, check(name, permissionsForRole(name)));
  }
  console.log("Employee", check("Employee", permissionsForRole("Employee")));

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.log("\nNo MONGODB_URI — skip DB check");
    process.exit(0);
  }

  await mongoose.connect(uri);
  console.log("\n=== DB Role.permissions ===");
  const rows = await Role.find({ name: { $in: NAMES } }).lean();
  for (const name of NAMES) {
    const r = rows.find((x) => x.name === name);
    if (!r) {
      console.log(name, "MISSING in DB");
      continue;
    }
    const full = permissionsForRole(name);
    const stale =
      countPermissions(r.permissions) !== countPermissions(full) ||
      !findAction(r.permissions, "Break", "Live Break Status", "view");
    console.log(name, {
      ...check(name, r.permissions),
      staleNeedsSync: stale,
      dbSlots: countPermissions(r.permissions),
      catalogSlots: countPermissions(full),
    });
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
