/**
 * Auth controller
 *
 * login — officialEmail + password → JWT + permissions + menu
 * me    — current user profile with role permissions
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Role = require("../models/Role");
const { countPermissions, totalForRole, menuForPermissions } = require("../config/permissions");

/** Human-readable permission count, e.g. "42 of 120" */
const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(roleDoc.name)}`;
};

/** Create a JWT for the given user id */
const makeToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

/** Find user by official email (login ID) */
const findByOfficialEmail = (officialEmail) =>
  User.findOne({ "personal.officialEmail": String(officialEmail).toLowerCase().trim() });

/** POST /api/auth/login — returns JWT, permissions, and menu */
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

    const roleDoc = await Role.findOne({ name: user.role });
    const token = makeToken(user._id);

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        officialEmail: user.personal?.officialEmail || "",
        role: user.role,
        department: user.official?.department || "",
        company: user.official?.company || "",
        status: user.status,
        lastLogin: user.lastLogin,
        permissions: roleDoc ? roleDoc.permissions : [],
        permissionCount: permLabel(roleDoc),
        menu: roleDoc ? menuForPermissions(roleDoc.permissions) : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/auth/me — current user + role permissions */
const me = async (req, res) => {
  try {
    const roleDoc = await Role.findOne({ name: req.user.role });
    return res.json({
      user: req.user,
      permissions: roleDoc ? roleDoc.permissions : [],
      permissionCount: permLabel(roleDoc),
      menu: roleDoc ? menuForPermissions(roleDoc.permissions) : [],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { login, me };
