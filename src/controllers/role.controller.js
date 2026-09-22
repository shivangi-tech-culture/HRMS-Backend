/**
 * Role controller
 *
 * CRUD for roles plus get/save of flat permission blocks
 * ({ module, heading, subModules[] }).
 */
const Role = require("../models/Role");
const User = require("../models/User");
const {
  permissionsForRole,
  totalForRole,
  countPermissions,
  ALL_SUBS,
  ADMIN_TREE,
  normalizePermissions,
  menuForPermissions,
} = require("../config/permissions");

const permLabel = (role) =>
  `${countPermissions(role.permissions)} of ${totalForRole(role.name)}`;

/** POST /api/roles — create role with default permissions for that role type */
const createRole = async (req, res) => {
  try {
    // req.body already validated by Joi
    const { name, description, status } = req.body;
    const roleName = name.trim();

    const exists = await Role.findOne({ name: roleName });
    if (exists) {
      return res.status(400).json({ message: "Role name already exists" });
    }

    const role = await Role.create({
      name: roleName,
      description: description || "",
      status: status || "Active",
      permissions: permissionsForRole(roleName),
    });

    return res.status(201).json({
      message: "Role created",
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        permissionCount: permLabel(role),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/roles — list all roles with user counts */
const listRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: 1 });

    const list = [];
    for (const role of roles) {
      const users = await User.countDocuments({ role: role.name });
      list.push({
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        users,
        permissions: permLabel(role),
      });
    }

    return res.json({ count: list.length, roles: list });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/roles/:id — one role with full permissions */
const getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    const users = await User.countDocuments({ role: role.name });
    return res.json({
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        status: role.status,
        users,
        permissions: role.permissions,
        permissionCount: permLabel(role),
        menu: menuForPermissions(role.permissions),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** PUT /api/roles/:id — update name, description, or status */
const updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    if (req.body.name && req.body.name.trim() !== role.name) {
      const newName = req.body.name.trim();
      const exists = await Role.findOne({ name: newName });
      if (exists) {
        return res.status(400).json({ message: "Role name already exists" });
      }
      // Keep users in sync when role name changes
      await User.updateMany({ role: role.name }, { role: newName });
      role.name = newName;
    }

    if (req.body.description !== undefined) role.description = req.body.description;
    if (req.body.status) role.status = req.body.status;

    await role.save();
    return res.json({ message: "Role updated", role });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** DELETE /api/roles/:id — blocked if any users still use this role */
const deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
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

/** GET /api/roles/:id/permissions — permission matrix for this role */
const getPermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    const byModule = {};
    for (const m of [...new Set(ADMIN_TREE.map((x) => x.module))]) {
      byModule[m] = (role.permissions || []).filter((p) => p.module === m);
    }

    return res.json({
      roleId: role._id,
      roleName: role.name,
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
 * PUT /api/roles/:id/permissions
 * Body: { permissions: [ { module, heading, subModules: [...] } ] }
 */
const savePermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    // Merge with full tree; missing = false
    role.permissions = normalizePermissions(req.body.permissions);
    await role.save();

    return res.json({
      message: "Permissions saved",
      roleName: role.name,
      permissionCount: permLabel(role),
      permissions: role.permissions,
      menu: menuForPermissions(role.permissions),
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
};
