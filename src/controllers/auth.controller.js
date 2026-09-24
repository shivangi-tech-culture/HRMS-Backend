/**
 * Auth controller — login and current user
 *
 * POST /api/auth/login  → check official email + password → JWT + permissions
 *
 * Login ID is stored at: official.officialEmail
 */
const bcrypt = require("bcryptjs"); // compare hashed passwords
const jwt = require("jsonwebtoken"); // create access tokens
const User = require("../models/User");
const Role = require("../models/Role");
const {
  countPermissions,
  totalForRole,
} = require("../config/permissions");

/** Build a short label like "42 of 120" for the UI */
const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(roleDoc.name)}`;
};

/** Create a signed JWT for this user id (used after login) */
const makeToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

/** Find one user by login email (case-insensitive) */
const findByOfficialEmail = (officialEmail) =>
  User.findOne({
    "official.officialEmail": String(officialEmail).toLowerCase().trim(),
  });

/**
 * POST /api/auth/login
 * Body: { officialEmail, password }
 * Returns: token + user + permissions (one list — no duplicate menu)
 */
const login = async (req, res) => {
  try {
    const { officialEmail, password } = req.body;

    // 1) Find account by official email
    const user = await findByOfficialEmail(officialEmail);
    if (!user) {
      // Same message for "not found" and "wrong password" (safer)
      return res.status(401).json({ message: "Invalid official email or password" });
    }

    // 2) Check password against stored hash
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid official email or password" });
    }

    // 3) Block inactive accounts
    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    // 4) Remember last login time
    user.lastLogin = new Date();
    await user.save();

    // 5) Load role permissions (single list for sidebar + access checks)
    const roleDoc = await Role.findOne({ name: user.role });
    const token = makeToken(user._id);

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        officialEmail: user.official?.officialEmail || "",
        role: user.role,
        department: user.official?.department || "",
        company: user.official?.company || "",
        status: user.status,
        lastLogin: user.lastLogin,
        permissionCount: permLabel(roleDoc),
        permissions: roleDoc ? roleDoc.permissions : [],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { login };
