/**
 * Add new catalog submodules (e.g. Administration → Hierarchy) to existing Role docs.
 * Does NOT wipe users or change grants a role already has. Safe to re-run.
 *
 * System roles get their defaults (permissionsForRole); custom roles get the new rows all false.
 * Super Admin / Admin are reset to the full platform matrix (they are locked).
 *
 * Run: npm run sync:permissions
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Role = require("../models/Role");
const {
  ADMIN_TREE,
  ESS_TREE,
  permissionsForRole,
  normalizePermissions,
  countPermissions,
  totalForRole,
} = require("../config/permissions");
const {
  SYSTEM_ROLES,
  LOCKED_ROLES,
  EMPLOYEE,
} = require("../config/roles");

const run = async () => {
  await connectDB();

  for (const role of await Role.find()) {
    const before = countPermissions(role.permissions);

    if (LOCKED_ROLES.includes(role.name)) {
      role.permissions = permissionsForRole(role.name);
    } else {
      const isEss = role.name === EMPLOYEE || role.catalog === "employee";
      const defaults = SYSTEM_ROLES.includes(role.name)
        ? permissionsForRole(role.name)
        : normalizePermissions([], isEss ? ESS_TREE : ADMIN_TREE);

      const current = role.permissions || [];
      let added = 0;
      for (const block of defaults) {
        const existing = current.find(
          (b) => b.module === block.module && b.heading === block.heading
        );
        if (!existing) {
          current.push(block);
          added += block.subModules.length;
          continue;
        }
        for (const sub of block.subModules) {
          if (!(existing.subModules || []).some((s) => s.name === sub.name)) {
            existing.subModules.push(sub);
            added += 1;
          }
        }
      }
      if (!added) {
        console.log(`${role.name}: up to date`);
        continue;
      }
      role.permissions = current;
      role.markModified("permissions");
    }

    await role.save();
    console.log(
      `${role.name}: ${before} → ${countPermissions(role.permissions)} of ${totalForRole(role.name, role.catalog)}`
    );
  }

  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
