/**
 * Replace Employee role permissions from ESS_TREE catalog.
 *
 * Run: node src/scripts/syncEmployeePermissions.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const {
  permissionsForRole,
  countPermissions,
} = require("../config/permissions");

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const role = await Role.findOne({ name: "Employee" });
  if (!role) {
    console.log("Employee — not in DB, skip");
    process.exit(0);
  }

  role.permissions = permissionsForRole("Employee");
  role.markModified("permissions");
  await role.save();

  const modules = (role.permissions || []).map((b) => ({
    module: b.module,
    pages: (b.subModules || []).map((s) => s.name),
  }));
  console.log("Employee", {
    slots: countPermissions(role.permissions),
    modules,
  });

  await mongoose.disconnect();
  console.log("\nDone. Employee users must re-login.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
