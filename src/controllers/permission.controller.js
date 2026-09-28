/**
 * PERMISSION CONTROLLER — catalogs, my permissions, checkPermission guard
 */
const Role = require("../models/Role");

const { hasAllAccess, classifyRoleAccess } = require("../middleware/auth");
const {
  ADMIN_TREE,
  ESS_TREE,
  ACTIONS,
  totalForRole,
  countPermissions,
  compactPermissions,
  findAction,
} = require("../config/permissions");

/**
 * Catalog added Access & Control → create; older DBs still have create:false.
 * If role already has view+edit+delete, grant create once.
 */
async function grantAccessCreateIfNeeded(role) {
  if (!role || role.name === "Employee") return;
  let changed = false;
  for (const block of role.permissions || []) {
    if (block.module !== "Administration") continue;
    for (const sub of block.subModules || []) {
      if (sub.name !== "Access & Control") continue;
      if (sub.view && sub.edit && sub.delete && sub.create !== true) {
        sub.create = true;
        changed = true;
      }
    }
  }
  if (changed) {
    role.markModified("permissions");
    await role.save();
  }
}

/** LIST MODULES — GET /api/permissions/modules (admin + employee catalogs) */
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

/** MY PERMISSIONS — GET /api/permissions/my (compact matrix for req.user.role) */
const myPermissions = async (req, res) => {
  try {
    const role = await Role.findOne({ name: req.user.role });
    if (!role) return res.status(404).json({ message: "Role not found for user" });

    const data = role.permissions || [];
    const { adminAccess } = classifyRoleAccess(
      role.name,
      data,
      role.catalog
    );
    // side = catalog chosen at create (admin|employee); modules may be subset
    const side = role.catalog || (adminAccess ? "admin" : "employee");

    return res.json({
      role: role.name,
      side,
      catalog: side,
      permissionCount: `${countPermissions(data)} of ${totalForRole(role.name, side)}`,
      count: data.length,
      data: compactPermissions(data),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Route guard: checkPermission(module, subModuleName, action) — Global/Super Admin always pass */
const checkPermission = (module, name, action) => {
  return async (req, res, next) => {
    try {
      // Super Admin always has every action. Their matrix cannot be reduced.
      if (
        req.user.role === "Global Admin" ||
        req.user.role === "Super Admin"
      ) {
        return next();
      }

      const role = await Role.findOne({ name: req.user.role });
      if (!role) {
        return res.status(403).json({ message: "Role not found" });
      }

      // Older matrices had Access & Control create:false; grant if they already manage users
      if (
        module === "Administration" &&
        name === "Access & Control" &&
        action === "create"
      ) {
        await grantAccessCreateIfNeeded(role);
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

/**
 * Employee profile APIs (same PUT/GET for admin + employee).
 * Admin (HR/Manager/…) → Employee → Employee → action
 * Employee role → Self → General Info → action (ESS matrix)
 * Global / Super Admin always pass.
 */
const checkEmployeeProfilePermission = (action) => {
  return (req, res, next) => {
    if (hasAllAccess(req.user)) {
      return checkPermission("Employee", "Employee", action)(req, res, next);
    }
    return checkPermission("Self", "General Info", action)(req, res, next);
  };
};

/**
 * Master type → Masters module submodule (admin catalog).
 * GET list/get: no matrix check (web app dropdowns — Employee + Admin).
 * POST/PUT/DELETE: Masters → {Company|Department|…} → action
 */
const MASTER_TYPE_PERM = {
  company: "Company",
  department: "Department",
  designation: "Designation",
  division: "Division",
  employeeGroup: "Employee Group",
  grade: "Grade",
  jobRole: "Job Role",
  gender: "Gender",
  maritalStatus: "Marital Status",
  bloodGroup: "Blood Group",
  country: "Country",
  state: "State",
  city: "City",
  courseType: "Course Type",
  courseLevel: "Course Level",
  bankName: "Bank Name",
  relation: "Relation",
  nominateFor: "Nominate For",
  visaType: "Visa Type",
};

/** Admin write on /api/masters — type from body, query, or :id lookup */
const checkMasterPermission = (action) => {
  return async (req, res, next) => {
    try {
      let type =
        req.query?.type || req.body?.type || req.masterType || null;

      if (!type && req.params?.id) {
        const { findMasterByIdLean } = require("../models/Master");
        const found = await findMasterByIdLean(req.params.id);
        if (!found) {
          return res.status(404).json({ message: "Not found" });
        }
        type = found.type;
        req.masterType = type;
      }

      if (!type) {
        const { TYPES } = require("../models/Master");
        return res.status(400).json({
          message: `type is required: ${TYPES.join(", ")}`,
        });
      }

      const subName = MASTER_TYPE_PERM[type];
      if (!subName) {
        return res.status(400).json({ message: `Invalid master type: ${type}` });
      }

      return checkPermission("Masters", subName, action)(req, res, next);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  };
};

module.exports = {
  listModules,
  myPermissions,
  checkPermission,
  checkEmployeeProfilePermission,
  checkMasterPermission,
};
