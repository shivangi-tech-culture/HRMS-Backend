/**
 * Replace Admin-side role permissions from the current catalog.
 * Super Admin / Admin → PLATFORM_TREE (includes Administration → Companies)
 * HR / Reporting Manager → ADMIN_TREE
 *
 * Also removes legacy modules (Organization, Work Schedule / Weekly Off).
 *
 * Run: node src/scripts/syncAdminPermissions.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Role = require("../models/Role");
const {
  permissionsForRole,
  countPermissions,
  findAction,
} = require("../config/permissions");

const NAMES = ["Super Admin", "Admin", "HR Manager", "Reporting Manager"];

const snapshot = (perms) => ({
  slots: countPermissions(perms),
  workTasks: findAction(perms, "Work", "Tasks", "view"),
  weeklyOff: findAction(perms, "Work", "Weekly Off", "view"),
  connectMail: findAction(perms, "Connect", "Mail", "email"),
  orgMail: findAction(perms, "Organization", "Mail", "email"),
  companies: findAction(perms, "Administration", "Companies", "view"),
  companyLegacy: findAction(perms, "Administration", "Company", "view"),
  onTourCat: findAction(perms, "Masters", "On Tour Category", "view"),
  onDutyCat: findAction(perms, "Masters", "On Duty Category", "view"),
  modules: (perms || []).map((b) => b.module).join(", "),
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
    role.permissions = permissionsForRole(name);
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
