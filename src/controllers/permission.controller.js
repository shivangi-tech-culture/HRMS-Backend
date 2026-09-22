/**
 * Permission helpers and APIs
 *
 * - Catalog of modules / actions (from config/permissions.js)
 * - Current user's permissions + sidebar menu
 * - checkPermission() middleware for route-level action checks
 */
const Role = require("../models/Role");
const {
  MODULE_TREE,
  ADMIN_TREE,
  ESS_TREE,
  MODULES,
  ACTIONS,
  TOTAL_PERMISSIONS,
  totalForRole,
  countPermissions,
  findAction,
  menuForPermissions,
} = require("../config/permissions");

/**
 * GET /api/permissions/modules
 * Returns the full permission catalog (admin + ESS trees).
 */
const listModules = async (req, res) => {
  return res.json({
    modules: MODULES,
    actions: ACTIONS,
    adminModules: [...new Set(ADMIN_TREE.map((b) => b.module))],
    essModules: [...new Set(ESS_TREE.map((b) => b.module))],
    total: TOTAL_PERMISSIONS,
    tree: MODULE_TREE,
  });
};

/**
 * GET /api/permissions/my
 * Returns the logged-in role's permission flags and filtered menu.
 */
const myPermissions = async (req, res) => {
  try {
    const role = await Role.findOne({ name: req.user.role });
    if (!role) return res.status(404).json({ message: "Role not found for user" });

    return res.json({
      role: role.name,
      permissions: role.permissions,
      permissionCount: `${countPermissions(role.permissions)} of ${totalForRole(role.name)}`,
      menu: menuForPermissions(role.permissions),
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
