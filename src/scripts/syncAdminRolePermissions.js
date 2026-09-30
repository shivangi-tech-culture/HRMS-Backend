/**
 * Sync locked admin roles (Super Admin / Global Admin) to live permissions.js.
 * Does NOT wipe users/masters. Safe to re-run.
 *
 * Run: node src/scripts/syncAdminRolePermissions.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Role = require("../models/Role");
const {
  permissionsForRole,
  countPermissions,
  totalForRole,
} = require("../config/permissions");

const LOCKED = ["Super Admin", "Global Admin"];

(async () => {
  await connectDB();
  for (const name of LOCKED) {
    const role = await Role.findOne({ name });
    if (!role) {
      console.log(`Skip — role not found: ${name}`);
      continue;
    }
    const full = permissionsForRole(name);
    const before = countPermissions(role.permissions);
    role.permissions = full;
    await role.save();
    const after = countPermissions(role.permissions);
    console.log(
      `${name}: ${before} → ${after} of ${totalForRole(name)} (Work Timings removed; Masters +2 reasons)`
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
