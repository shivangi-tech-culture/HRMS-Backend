/**
 * Sync Break module (Live + History + Policy) onto Admin / HR / Reporting Manager roles.
 * Run: node src/scripts/syncBreakPermissions.js
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

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);

  for (const name of NAMES) {
    const role = await Role.findOne({ name });
    if (!role) {
      console.log(name, "— not in DB, skip");
      continue;
    }
    const full = permissionsForRole(name);
    const breakBlock = full.find((b) => b.module === "Break");
    if (!breakBlock) {
      console.log(name, "— catalog has no Break");
      continue;
    }

    const idx = (role.permissions || []).findIndex((b) => b.module === "Break");
    if (idx >= 0) {
      role.permissions[idx] = breakBlock;
    } else {
      role.permissions.push(breakBlock);
    }
    role.markModified("permissions");
    await role.save();

    console.log(name, {
      liveView: findAction(role.permissions, "Break", "Live Break Status", "view"),
      histView: findAction(role.permissions, "Break", "Break History", "view"),
      policyView: findAction(role.permissions, "Break", "Break Policy", "view"),
      policyCreate: findAction(role.permissions, "Break", "Break Policy", "create"),
      policyEdit: findAction(role.permissions, "Break", "Break Policy", "edit"),
      policyDelete: findAction(role.permissions, "Break", "Break Policy", "delete"),
      slots: countPermissions(role.permissions),
    });
  }

  await mongoose.disconnect();
  console.log("\nDone. Re-login users so menu refreshes.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
