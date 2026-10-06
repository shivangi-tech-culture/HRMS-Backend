/**
 * Migrate legacy roles → new hierarchy (no wipe).
 *
 * Global Admin  → Admin  (or Super Admin if none exists and user is first)
 * Manager       → Reporting Manager
 * (HR Manager / Super Admin / Employee unchanged)
 *
 * Also ensures Role docs exist for Admin + Reporting Manager.
 *
 * Run: node src/scripts/migrateRoles.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const User = require("../models/User");
const Role = require("../models/Role");
const {
  permissionsForRole,
} = require("../config/permissions");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  ROLE_DESCRIPTIONS,
  maxSuperAdmins,
} = require("../config/roles");

async function ensureRole(name, catalog) {
  let role = await Role.findOne({ name });
  if (!role) {
    role = await Role.create({
      name,
      description: ROLE_DESCRIPTIONS[name] || "",
      catalog,
      permissions: permissionsForRole(name),
      status: "Active",
    });
    console.log(`Created role → ${name}`);
  } else {
    console.log(`Role exists → ${name}`);
  }
  return role;
}

const run = async () => {
  await connectDB();

  await ensureRole(SUPER_ADMIN, "admin");
  await ensureRole(ADMIN, "admin");
  await ensureRole(HR, "admin");
  await ensureRole(REPORTING_MANAGER, "admin");
  await ensureRole(EMPLOYEE, "employee");

  // Remove Global Admin role doc after migrating users
  const globalUsers = await User.find({ role: "Global Admin" });
  const superCount = await User.countDocuments({ role: SUPER_ADMIN });
  const maxSA = maxSuperAdmins();

  for (const u of globalUsers) {
    // Prefer Admin (multiple). Only promote to Super Admin if none exist.
    if (superCount < maxSA && globalUsers.indexOf(u) === 0 && superCount === 0) {
      u.role = SUPER_ADMIN;
      console.log(`User ${u.official?.officialEmail} Global Admin → Super Admin`);
    } else {
      u.role = ADMIN;
      console.log(`User ${u.official?.officialEmail} Global Admin → Admin`);
    }
    if (u.official) {
      u.official.companies = undefined;
    }
    await u.save();
  }

  const mgr = await User.updateMany(
    { role: "Manager" },
    { $set: { role: REPORTING_MANAGER }, $unset: { "official.companies": 1 } }
  );
  console.log(`Manager → Reporting Manager: ${mgr.modifiedCount} users`);

  const del = await Role.deleteMany({ name: "Global Admin" });
  console.log(`Deleted Global Admin role docs: ${del.deletedCount}`);

  const delMgr = await Role.deleteMany({ name: "Manager" });
  console.log(`Deleted Manager role docs: ${delMgr.deletedCount}`);

  console.log("\nDone. Hierarchy:");
  for (const name of [SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER, EMPLOYEE]) {
    const n = await User.countDocuments({ role: name });
    console.log(`  ${name}: ${n} users`);
  }
  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
