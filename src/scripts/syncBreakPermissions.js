/**
 * Sync Break module (all UI tabs) onto Admin / HR / Reporting Manager roles.
 * Flags are true/false per action (view, approve, reject, …).
 *
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

const snapshot = (perms) => ({
  liveView: findAction(perms, "Break", "Live Break Status", "view"),
  pendingView: findAction(perms, "Break", "Pending Review", "view"),
  pendingApprove: findAction(perms, "Break", "Pending Review", "approve"),
  pendingReject: findAction(perms, "Break", "Pending Review", "reject"),
  histView: findAction(perms, "Break", "Break History", "view"),
  policyView: findAction(perms, "Break", "Break Policy", "view"),
  policyCreate: findAction(perms, "Break", "Break Policy", "create"),
  policyEdit: findAction(perms, "Break", "Break Policy", "edit"),
  policyDelete: findAction(perms, "Break", "Break Policy", "delete"),
  slots: countPermissions(perms),
});

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in .env");
    process.exit(1);
  }
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
      role.permissions = role.permissions || [];
      role.permissions.push(breakBlock);
    }
    role.markModified("permissions");
    await role.save();

    console.log(name, snapshot(role.permissions));
  }

  await mongoose.disconnect();
  console.log("\nDone. Re-login users so menu / permissions refresh.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
