/**
 * Permission helpers and APIs
 *
 * - Catalog of modules / actions (from config/permissions.js)
 * - Current user's permissions + sidebar menu
 * - checkPermission() middleware for route-level action checks
 *
 * Catalog returns 2 records in data[]:
 *   { side: "admin", modules: [...] }
 *   { side: "employee", modules: [...] }
 */
const Role = require("../models/Role");
const {
  ADMIN_TREE,
  ESS_TREE,
  ACTIONS,
  totalForRole,
  countPermissions,
  findAction,
} = require("../config/permissions");

/**
 * GET /api/permissions/modules
 *
 * Two records only (side once each — not on every module):
 *
 * {
 *   actions: [...],
 *   count: 2,
 *   data: [
 *     { side: "admin", modules: [ { module, heading, subModules }, ... ] },
 *     { side: "employee", modules: [ { module, heading, subModules }, ... ] }
 *   ]
 * }
 */
const listModules = async (req, res) => {
  const data = [
    {
      side: "admin", // Super Admin / HR Manager / Manager — once
      modules: ADMIN_TREE,
    },
    {
      side: "employee", // Employee ESS — once
      modules: ESS_TREE,
    },
  ];

  return res.json({
    actions: ACTIONS,
    count: data.length, // 2
    data,
  });
};

/**
 * GET /api/permissions/my
 *
 * One list only — no separate `menu` (that was the same data twice).
 *
 * {
 *   role, side, permissionCount, count,
 *   data: [ { module, heading, subModules: [ { name, view, create, ... } ] } ]
 * }
 *
 * Sidebar: use pages where view === true from data.
 */
const myPermissions = async (req, res) => {
  try {
    const role = await Role.findOne({ name: req.user.role });
    if (!role) return res.status(404).json({ message: "Role not found for user" });

    const data = role.permissions || [];
    const side = role.name === "Employee" ? "employee" : "admin";

    return res.json({
      role: role.name,
      side,
      permissionCount: `${countPermissions(data)} of ${totalForRole(role.name)}`,
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Route guard: checkPermission(module, subModuleName, action)
 *
 * Example: checkPermission("Attendance", "Daily Attendance", "create")
 * Pass name = null to allow if any submodule under that module has the action.
 */
const checkPermission = (module, name, action) => {
  return async (req, res, next) => {
    try {
      // Super Admin always has every action. Their matrix cannot be reduced.
      if (req.user.role === "Super Admin") return next();

      const role = await Role.findOne({ name: req.user.role });
      if (!role) {
        return res.status(403).json({ message: "Role not found" });
      }

      let ok = false;
      if (!name) {
        ok = (role.permissions || []).some(
          (p) =>
            p.module === module &&
            (p.subModules || []).some((s) => s[action])
        );
      } else {
        ok = findAction(role.permissions, module, name, action);
      }

      if (!ok) {
        return res.status(403).json({
          message: `No permission: ${module} → ${name || "*"} → ${action}`,
        });
      }

      req.roleDoc = role;
      next();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  };
};

module.exports = {
  listModules,
  myPermissions,
  checkPermission,
};
