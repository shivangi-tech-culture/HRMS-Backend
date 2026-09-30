/**
 * ROLE CONTROLLER — /api/roles
 * Role CRUD + permission matrix. Hierarchy: src/config/roles.js
 */
const Role = require("../models/Role");
const User = require("../models/User");
const {
  permissionsForRole,
  totalForRole,
  countPermissions,
  ALL_SUBS,
  ADMIN_TREE,
  ESS_TREE,
  normalizePermissions,
  compactPermissions,
} = require("../config/permissions");
const {
  SUPER_ADMIN,
  ADMIN,
  EMPLOYEE,
  SYSTEM_ROLES,
  LOCKED_ROLES,
  ROLE_DESCRIPTIONS,
  maxSuperAdmins,
  normalizeRoleName,
  isSuperAdmin,
  isLockedRoleName,
  canManageRole,
} = require("../config/roles");

/** Pick catalog tree for normalize — admin OR employee only */
const treeForCatalog = (catalog) => {
  if (catalog === "employee") return ESS_TREE;
  return ADMIN_TREE;
};

const grantedPermissions = (incoming, tree) =>
  compactPermissions(normalizePermissions(incoming, tree));

const isLockedRole = (role) =>
  isLockedRoleName(typeof role === "string" ? role : role?.name);

/** @deprecated use maxSuperAdmins — kept for any old imports */
const maxGlobalAdmins = () => maxSuperAdmins();

async function forceFullAdminAccess(role) {
  const full = permissionsForRole(role.name);
  const stale =
    countPermissions(role.permissions) !== countPermissions(full) ||
    JSON.stringify(role.permissions) !== JSON.stringify(full);
  if (stale) {
    role.permissions = full;
    await role.save();
  }
  return role;
}

async function grantAccessControlCreate(role) {
  if (!role || role.name === EMPLOYEE) return role;
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
  return role;
}

const permLabel = (role) =>
  `${countPermissions(role.permissions)} of ${totalForRole(role.name, role.catalog)}`;

/**
 * Hierarchy overview — GET /api/roles/hierarchy
 * Easy-to-read role ladder for UI / docs.
 */
const getHierarchy = async (_req, res) => {
  try {
    const ladder = [
      {
        rank: 1,
        role: SUPER_ADMIN,
        maxUsers: maxSuperAdmins(),
        companyAccess: "All companies",
        canCreate: [ADMIN, "HR Manager", "Reporting Manager", EMPLOYEE],
        notes: ROLE_DESCRIPTIONS[SUPER_ADMIN],
      },
      {
        rank: 2,
        role: ADMIN,
        maxUsers: "unlimited",
        companyAccess: "All companies",
        canCreate: ["HR Manager", "Reporting Manager", EMPLOYEE],
        notes: ROLE_DESCRIPTIONS[ADMIN],
      },
      {
        rank: 3,
        role: "HR Manager",
        maxUsers: "unlimited",
        companyAccess: "Assigned companies (Super Admin sets official.companies)",
        canCreate: [EMPLOYEE],
        notes: ROLE_DESCRIPTIONS["HR Manager"],
      },
      {
        rank: 4,
        role: "Reporting Manager",
        maxUsers: "unlimited",
        companyAccess: "Single company — team (reportingHead) only",
        canCreate: [],
        notes: ROLE_DESCRIPTIONS["Reporting Manager"],
      },
      {
        rank: 5,
        role: EMPLOYEE,
        maxUsers: "unlimited",
        companyAccess: "Own company — self ESS only",
        canCreate: [],
        notes: ROLE_DESCRIPTIONS[EMPLOYEE],
      },
    ];

    const counts = {};
    for (const name of SYSTEM_ROLES) {
      counts[name] = await User.countDocuments({ role: name });
    }

    return res.json({
      message: "Role hierarchy",
      removed: ["Global Admin"],
      legacyAliases: {
        "Global Admin": SUPER_ADMIN,
        Manager: "Reporting Manager",
        HR: "HR Manager",
      },
      hierarchy: ladder,
      userCounts: counts,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createRole = async (req, res) => {
  try {
    const { name, description, status, permissions } = req.body;
    const roleName = name.trim();
    const normalized = normalizeRoleName(roleName);

    if (SYSTEM_ROLES.includes(normalized) || roleName === "Global Admin") {
      return res.status(403).json({
        message: `"${roleName}" is a system role. Create users via Access & Control (POST /api/users).`,
      });
    }

    const exists = await Role.findOne({ name: roleName });
    if (exists) {
      return res.status(400).json({ message: "Role name already exists" });
    }

    // Create Role UI always uses ADMIN permission tree (hide/show modules)
    const cat = "admin";
    const tree = ADMIN_TREE;
    const perms = grantedPermissions(permissions, tree);

    if (!perms.length) {
      return res.status(400).json({
        message:
          "permissions must grant at least one action (hide unused modules; keep at least one true)",
      });
    }

    const role = await Role.create({
      name: roleName,
      description: description || "",
      status: status || "Active",
      catalog: cat,
      permissions: perms,
    });

    return res.status(201).json({
      message: "Role created (admin permissions)",
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        catalog: role.catalog,
        permissionCount: permLabel(role),
        permissions: role.permissions,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const listRoles = async (req, res) => {
  try {
    // Hide Super Admin role from Admin actors (cannot escalate)
    const filter = isSuperAdmin(req.user)
      ? {}
      : { name: { $nin: [SUPER_ADMIN, "Global Admin"] } };

    const roles = await Role.find(filter).sort({ createdAt: 1 });

    const list = [];
    for (const role of roles) {
      const users = await User.countDocuments({ role: role.name });
      list.push({
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        catalog:
          role.catalog ||
          (role.name === EMPLOYEE ? "employee" : "admin"),
        users,
        permissions: permLabel(role),
        locked: isLockedRole(role),
      });
    }

    return res.json({ count: list.length, roles: list });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    if (
      normalizeRoleName(role.name) === SUPER_ADMIN &&
      !isSuperAdmin(req.user)
    ) {
      return res.status(404).json({ message: "Role not found" });
    }

    const users = await User.countDocuments({ role: role.name });
    return res.json({
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        catalog:
          role.catalog ||
          (role.name === EMPLOYEE ? "employee" : "admin"),
        users,
        permissions: role.permissions,
        permissionCount: permLabel(role),
        locked: isLockedRole(role),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (isLockedRole(role)) {
      return res.status(403).json({
        message: `${role.name} role cannot be edited.`,
      });
    }

    if (req.body.description !== undefined) role.description = req.body.description;
    if (req.body.status) role.status = req.body.status;

    await role.save();
    return res.json({ message: "Role updated", role });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (isLockedRole(role)) {
      return res.status(403).json({
        message: `${role.name} role cannot be deleted.`,
      });
    }

    const users = await User.countDocuments({ role: role.name });
    if (users > 0) {
      return res
        .status(400)
        .json({ message: "Cannot delete. Users are using this role." });
    }

    await role.deleteOne();
    return res.json({ message: "Role deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET PERMISSIONS — GET /api/roles/:id/permissions
 *
 * Auth: logged in + Roles & Permissions → view
 *
 * Returns the full module → heading → subModules matrix for this role.
 * Locked roles are forced back to full admin access before reading.
 */
const getPermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    if (
      normalizeRoleName(role.name) === SUPER_ADMIN &&
      !isSuperAdmin(req.user)
    ) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (isLockedRole(role)) await forceFullAdminAccess(role);
    else await grantAccessControlCreate(role);

    const byModule = {};
    for (const m of [...new Set(ADMIN_TREE.map((x) => x.module))]) {
      byModule[m] = (role.permissions || []).filter((p) => p.module === m);
    }

    return res.json({
      roleId: role._id,
      roleName: role.name,
      catalog:
        role.catalog ||
        (role.name === EMPLOYEE ? "employee" : "admin"),
      title: `${role.name} permissions`,
      structure: "module + heading + subModules[]",
      totalNodes: ALL_SUBS.length,
      permissionCount: permLabel(role),
      permissions: role.permissions,
      byModule,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * SAVE PERMISSIONS — PUT /api/roles/:id/permissions
 * Custom roles + HR / Reporting Manager → always admin catalog (hide/show).
 * System Employee → ESS only. Super Admin / Admin locked.
 */
const savePermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    if (
      normalizeRoleName(role.name) === SUPER_ADMIN &&
      !isSuperAdmin(req.user)
    ) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (isLockedRole(role)) {
      await forceFullAdminAccess(role);
      return res.status(403).json({
        message: `${role.name} always has full access. Permissions cannot be changed.`,
      });
    }

    let tree;
    let catalog;
    if (role.name === EMPLOYEE) {
      tree = ESS_TREE;
      catalog = "employee";
    } else {
      // Always admin matrix for create/edit role hide-show
      tree = ADMIN_TREE;
      catalog = "admin";
    }

    const perms = grantedPermissions(req.body.permissions, tree);
    if (!perms.length) {
      return res.status(400).json({
        message:
          "permissions must grant at least one action (hide unused; keep at least one true)",
      });
    }

    role.permissions = perms;
    role.catalog = catalog;
    await role.save();

    return res.json({
      message: "Permissions saved",
      roleName: role.name,
      catalog: role.catalog,
      permissionCount: permLabel(role),
      permissions: role.permissions,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createRole,
  listRoles,
  getRole,
  updateRole,
  deleteRole,
  getPermissions,
  savePermissions,
  getHierarchy,
  maxGlobalAdmins,
  maxSuperAdmins,
  canManageRole,
};
