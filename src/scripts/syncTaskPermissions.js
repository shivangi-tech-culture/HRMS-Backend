/**
 * Sync Work → Tasks onto Admin / HR / Reporting Manager roles.
 *
 * Run: node src/scripts/syncTaskPermissions.js
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
  view: findAction(perms, "Work", "Tasks", "view"),
  create: findAction(perms, "Work", "Tasks", "create"),
  edit: findAction(perms, "Work", "Tasks", "edit"),
  delete: findAction(perms, "Work", "Tasks", "delete"),
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
    const workBlock = full.find((b) => b.module === "Work");
    if (!workBlock) {
      console.log(name, "— catalog has no Work");
      continue;
    }

    const idx = (role.permissions || []).findIndex((b) => b.module === "Work");
    if (idx >= 0) {
      role.permissions[idx] = workBlock;
    } else {
      role.permissions = role.permissions || [];
      role.permissions.push(workBlock);
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
