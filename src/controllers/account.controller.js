/**
 * ACCOUNT / MY PROFILE — /api/account
 * UI: https://hrms-techculture.vercel.app/account/profile
 * Works for Admin + Employee (logged-in user only).
 */
const User = require("../models/User");
const Role = require("../models/Role");
const {
  countPermissions,
  totalForRole,
  compactPermissions,
  permissionsForRole,
} = require("../config/permissions");

const LOCKED_ROLES = new Set(["Super Admin", "Global Admin"]);

const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(
    roleDoc.name,
    roleDoc.catalog
  )}`;
};

/** Refresh Super / Global Admin from live permissions.js catalog */
async function refreshLockedRole(roleDoc) {
  if (!roleDoc || !LOCKED_ROLES.has(roleDoc.name)) return roleDoc;
  const full = permissionsForRole(roleDoc.name);
  if (JSON.stringify(roleDoc.permissions) !== JSON.stringify(full)) {
    roleDoc.permissions = full;
    await roleDoc.save();
  }
  return roleDoc;
}

/** Shape matching My Profile UI cards */
const toProfilePayload = (user, roleDoc) => {
  const official = user.official || {};
  const personal = user.personal || {};
  return {
    id: user._id,
    fullName: user.name || "",
    name: user.name || "",
    workEmail: official.officialEmail || "",
    officialEmail: official.officialEmail || "",
    role: user.role || "",
    company: official.company || "",
    department: official.department || "",
    designation: official.designation || "",
    employeeCode: official.employeeCode || "",
    status: user.status || "Active",
    mobileNo: personal.mobileNo || "",
    workPhone: personal.workPhone || "",
    lastLogin: user.lastLogin || null,
    avatar: user.avatar || null,
    signedInAs: user.name || "",
    permissionCount: permLabel(roleDoc),
    catalog: roleDoc?.catalog || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
};

/**
 * GET /api/account/profile — My Profile (current login)
 */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);

    return res.json({
      message: "My Profile",
      data: toProfilePayload(user, roleDoc),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUT /api/account/profile — update own display name (lean admin account)
 * Body: { name? } — email/role/company not editable here
 */
const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name || name.length < 2) {
        return res.status(400).json({ message: "name must be at least 2 characters" });
      }
      user.name = name;
    }

    if (req.body.avatar !== undefined) {
      user.avatar = req.body.avatar || null;
    }

    await user.save();

    const roleDoc = await Role.findOne({ name: user.role }).lean();
    const lean = user.toObject();
    delete lean.password;

    return res.json({
      message: "Profile updated",
      data: toProfilePayload(lean, roleDoc),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/account/me — alias of profile (+ permissions compact, like login)
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);
    const profile = toProfilePayload(user, roleDoc);

    return res.json({
      message: "OK",
      user: {
        ...profile,
        permissions: roleDoc ? compactPermissions(roleDoc.permissions) : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  getMe,
};
