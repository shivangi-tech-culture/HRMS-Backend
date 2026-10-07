/**
 * AUTH CONTROLLER — /api/auth
 * POST /login · POST /logout (JWT httpOnly cookie)
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const {
  countPermissions,
  totalForRole,
  compactPermissions,
  permissionsForRole,
} = require("../config/permissions");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
const {
  companyListForUser,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { signToken } = require("../utils/jwt");

const LOCKED_ROLES = new Set(["Super Admin", "Admin"]);

/** Build a short label like "42 of 120" for the UI */
const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(roleDoc.name)}`;
};

/** Keep Super Admin / Admin matrix in sync with permissions.js catalog */
async function refreshLockedRole(roleDoc) {
  if (!roleDoc || !LOCKED_ROLES.has(roleDoc.name)) return roleDoc;
  const full = permissionsForRole(roleDoc.name);
  if (JSON.stringify(roleDoc.permissions) !== JSON.stringify(full)) {
    roleDoc.permissions = full;
    await roleDoc.save();
  }
  return roleDoc;
}

/** Find one user by login email (case-insensitive) */
const findByOfficialEmail = (officialEmail) =>
  User.findOne({
    "official.officialEmail": String(officialEmail).toLowerCase().trim(),
  });

/** LOGIN — POST /api/auth/login (officialEmail + password → JWT cookie) */
const login = async (req, res) => {
  try {
    const { officialEmail, password } = req.body;

    const user = await findByOfficialEmail(officialEmail);
    if (!user) {
      return res.status(401).json({ message: "Invalid official email or password" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid official email or password" });
    }

    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    user.lastLogin = new Date();
    await user.save();

    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);
    const token = signToken(user._id);
    setAuthCookie(res, token);

    const companies = (await companyListForUser(user)).map((row) => ({
      _id: row.companyId,
      companyName: row.companyName,
    }));

    return res.json({
      message: "Login successful",
      token, // optional: cookie is primary; Bearer still works for Swagger
      user: {
        id: user._id,
        name: user.name,
        officialEmail: user.official?.officialEmail || "",
        role: user.role,
        department: user.official?.department || "",
        allCompanies: hasGlobalCompanyAccess(user),
        companies,
        status: user.status,
        lastLogin: user.lastLogin,
        permissionCount: permLabel(roleDoc),
        permissions: roleDoc ? compactPermissions(roleDoc.permissions) : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** LOGOUT — POST /api/auth/logout (clear httpOnly token cookie) */
const logout = async (req, res) => {
  clearAuthCookie(res);
  return res.json({ message: "Logged out" });
};

module.exports = { login, logout };
