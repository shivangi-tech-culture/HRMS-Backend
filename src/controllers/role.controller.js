/**
 * ROLE CONTROLLER — /api/roles
 * Role CRUD + permission matrix. Super Admin / Global Admin stay full access.
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

const SUPER_ADMIN = "Super Admin";
const GLOBAL_ADMIN = "Global Admin";

/** Pick catalog tree for normalize — admin OR employee only */
const treeForCatalog = (catalog) => {
  if (catalog === "employee") return ESS_TREE;
  return ADMIN_TREE;
};

/**
 * Normalize against catalog, then keep only modules/actions that are true.
 * DB stores what the role can do — UI/routes see only those grants.
 */
const grantedPermissions = (incoming, tree) =>
  compactPermissions(normalizePermissions(incoming, tree));

/** True if this is the Global Admin system role (string name or role doc) */
const isGlobalAdminRole = (role) =>
  (typeof role === "string" ? role : role?.name) === GLOBAL_ADMIN;

/** Super Admin and Global Admin cannot be edited or deleted */
const isLockedRole = (role) =>
  role.name === SUPER_ADMIN || role.name === GLOBAL_ADMIN;

/** Soft cap for Global Admin user accounts (env MAX_GLOBAL_ADMINS, default 5) */
const maxGlobalAdmins = () => {
  const n = Number(process.env.MAX_GLOBAL_ADMINS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
};

/** Locked roles always keep the full admin permission matrix (from permissions.js) */
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

/**
 * Catalog added Access & Control → create; older matrices had create:false.
 * If the role can already manage users (view+edit+delete), grant create once.
 */
async function grantAccessControlCreate(role) {
  if (!role || role.name === "Employee") return role;
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

/** Short label like "42 of 120" (granted true actions / catalog max) */
const permLabel = (role) =>
  `${countPermissions(role.permissions)} of ${totalForRole(role.name, role.catalog)}`;

/**
 * CREATE — POST /api/roles
 *
 * Body: { name, catalog, permissions, description?, status? }
 * catalog: admin | employee (required — one side only)
 * permissions: required — decide matrix at create; only granted flags are stored.
 * Cannot create a role named "Global Admin" (system role only).
 */
const createRole = async (req, res) => {
  try {
    const { name, description, status, catalog, permissions } = req.body;
    const roleName = name.trim();

    if (roleName === GLOBAL_ADMIN) {
      return res.status(403).json({
        message:
          "Global Admin is a system role. Create Global Admin users via POST /api/users (Global Admin only).",
      });
    }

    const exists = await Role.findOne({ name: roleName });
    if (exists) {
      return res.status(400).json({ message: "Role name already exists" });
    }

    const cat = roleName === "Employee" ? "employee" : catalog;
    const tree = treeForCatalog(cat);
    const perms = grantedPermissions(permissions, tree);

    if (!perms.length) {
      return res.status(400).json({
        message:
          "permissions must grant at least one action (all false / empty is not allowed)",
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
      message: "Role created",
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

/**
 * LIST — GET /api/roles
 *
 * Auth: logged in + Roles & Permissions → view
 *
 * Global Admin actor → sees Global Admin in the list (can assign more owners).
 * Everyone else → Global Admin role is hidden (cannot escalate).
 */
const listRoles = async (req, res) => {
  try {
    const filter =
      req.user?.role === GLOBAL_ADMIN
        ? {}
        : { name: { $ne: GLOBAL_ADMIN } };

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
          (role.name === "Employee" ? "employee" : "admin"),
        users,
        permissions: permLabel(role),
      });
    }

    return res.json({ count: list.length, roles: list });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET ONE — GET /api/roles/:id
 *
 * Auth: logged in + Roles & Permissions → view
 * Non–Global Admin callers get 404 for the Global Admin role (hidden).
 */
const getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    if (isGlobalAdminRole(role) && req.user?.role !== GLOBAL_ADMIN) {
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
          (role.name === "Employee" ? "employee" : "admin"),
        users,
        permissions: role.permissions,
        permissionCount: permLabel(role),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * UPDATE — PUT /api/roles/:id
 *
 * Body: { description?, status? } — name never changes
 * Auth: typically admin (exported helper; check role.routes.js if mounted)
 *
 * Super Admin / Global Admin roles are blocked from editing.
 */
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

/**
 * DELETE — DELETE /api/roles/:id
 *
 * Auth: Global Admin or Super Admin + Roles & Permissions → delete
 *
 * Locked roles (Super Admin / Global Admin) cannot be deleted.
 * Other roles delete only when no user still has that role.
 */
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
      return res.status(400).json({ message: "Cannot delete. Users are using this role." });
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
    if (isGlobalAdminRole(role) && req.user?.role !== GLOBAL_ADMIN) {
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
        (role.name === "Employee" ? "employee" : "admin"),
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
 *
 * Body: { permissions, catalog? }
 * Employee → ESS. Super Admin / Global Admin locked.
 * Custom / HR / Manager → admin catalog (or body.catalog).
 * Only granted (true) modules/actions are stored — hide = omit / all false.
 */
const savePermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    if (isGlobalAdminRole(role) && req.user?.role !== GLOBAL_ADMIN) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (isLockedRole(role)) {
      await forceFullAdminAccess(role);
      return res.status(403).json({
        message: `${role.name} always has full access. Permissions cannot be changed.`,
      });
    }

    let tree;
    let catalog = role.catalog;
    if (role.name === "Employee") {
      tree = ESS_TREE;
      catalog = "employee";
    } else if (req.body.catalog) {
      tree = treeForCatalog(req.body.catalog);
      catalog = req.body.catalog;
    } else if (role.catalog) {
      tree = treeForCatalog(role.catalog);
    } else {
      // HR Manager, Manager, legacy custom — default admin catalog
      tree = ADMIN_TREE;
      catalog = "admin";
    }

    const perms = grantedPermissions(req.body.permissions, tree);
    if (!perms.length) {
      return res.status(400).json({
        message:
          "permissions must grant at least one action (all false / empty is not allowed)",
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
  maxGlobalAdmins,
};
