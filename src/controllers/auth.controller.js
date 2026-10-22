/**
 * AUTH CONTROLLER — /api/auth
 * POST /login · POST /logout · GET /token-status (JWT httpOnly cookie)
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
const {
  setAuthCookie,
  clearAuthCookie,
  readToken,
} = require("../utils/authCookie");
const {
  companyListForUser,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { signToken, decodeToken, JWT_EXPIRES_IN } = require("../utils/jwt");
const { inspectSessionToken } = require("../middleware/auth");

const LOCKED_ROLES = new Set(["Super Admin", "Admin", "Employee"]);

/** Build a short label like "42 of 120" for the UI */
const permLabel = (roleDoc) => {
  if (!roleDoc) return "0 of 0";
  return `${countPermissions(roleDoc.permissions)} of ${totalForRole(roleDoc.name)}`;
};

/** Keep Super Admin, Admin, and Employee matrices in sync with permissions.js */
async function refreshLockedRole(roleDoc) {
  if (!roleDoc || !LOCKED_ROLES.has(roleDoc.name)) return roleDoc;
  const full = permissionsForRole(roleDoc.name);
  if (JSON.stringify(roleDoc.permissions) !== JSON.stringify(full)) {
    roleDoc.permissions = full;
    await roleDoc.save();
  }
  return roleDoc;
}

/**
 * Mobile → last 10 digits (accepts +91, spaces, dashes). Null if not a mobile.
 */
const asMobile = (value) => {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
};

/**
 * Find user by one `username` value. Type is detected from its shape:
 * contains "@" → official or personal email · 10-digit number → mobile · else → employee code.
 */
const findByUsername = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.includes("@")) {
    const email = value.toLowerCase();
    return User.findOne({
      $or: [
        { "official.officialEmail": email },
        { "personal.personalEmail": email },
      ],
    });
  }

  const mobile = asMobile(value);
  if (mobile && /^[\d\s+()-]+$/.test(value)) {
    return User.findOne({ "personal.mobileNo": mobile });
  }

  return User.findOne({ "official.employeeCode": value.toUpperCase() });
};

/** Persist latest JWT on the user document (issued / expiry timestamps) */
const saveAuthTokenOnUser = async (user, token) => {
  const decoded = decodeToken(token);
  const issuedAt =
    decoded?.iat != null ? new Date(decoded.iat * 1000) : new Date();
  const expiresAt =
    decoded?.exp != null ? new Date(decoded.exp * 1000) : null;
  const expiresIn = String(JWT_EXPIRES_IN());

  // updateOne so token always lands in MongoDB (not lost on document.save edge cases)
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        token,
        tokenIssuedAt: issuedAt,
        tokenExpiresAt: expiresAt,
        tokenExpiresIn: expiresIn,
        lastLogin: issuedAt,
      },
      $unset: {
        authToken: 1,
        authTokenIssuedAt: 1,
        authTokenExpiresAt: 1,
        authTokenExpiresIn: 1,
      },
    }
  );

  user.token = token;
  user.tokenIssuedAt = issuedAt;
  user.tokenExpiresAt = expiresAt;
  user.tokenExpiresIn = expiresIn;
  user.lastLogin = issuedAt;
};

/** Clear stored JWT fields on the user */
const clearAuthTokenOnUser = async (userId) => {
  if (!userId) return;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        token: "",
        tokenIssuedAt: null,
        tokenExpiresAt: null,
        tokenExpiresIn: "",
      },
      $unset: {
        authToken: 1,
        authTokenIssuedAt: 1,
        authTokenExpiresAt: 1,
        authTokenExpiresIn: 1,
      },
    }
  );
};

/**
 * LOGIN — POST /api/auth/login
 * Body: { username, password } — username = employee code | email | mobile
 * → JWT cookie + DB
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await findByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    if (user.status !== "Active") {
      return res.status(401).json({ message: "Account is inactive" });
    }

    let roleDoc = await Role.findOne({ name: user.role });
    roleDoc = await refreshLockedRole(roleDoc);
    const token = signToken(user._id);
    await saveAuthTokenOnUser(user, token);
    setAuthCookie(res, token);
    if (user.official?.emailAppPasswordSet) require("../utils/liveMailbox").warm(String(user._id));

    const companies = (await companyListForUser(user)).map((row) => ({
      _id: row.companyId,
      companyName: row.companyName,
    }));

    return res.json({
      message: "Login successful",
      token, // optional: cookie is primary; Bearer still works for Swagger
      tokenExpiresAt: user.tokenExpiresAt,
      tokenExpiresIn: user.tokenExpiresIn,
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

/** LOGOUT — POST /api/auth/logout (clear cookie + DB token when present) */
const logout = async (req, res) => {
  try {
    const token = readToken(req);
    if (token) {
      const decoded = decodeToken(token);
      if (decoded?.id) {
        const user = await User.findById(decoded.id).select("token");
        if (user && (!user.token || user.token === token)) {
          await clearAuthTokenOnUser(user._id);
        }
      }
    }
  } catch {
    // still clear cookie even if DB clear fails
  }
  clearAuthCookie(res);
  return res.json({ message: "Logged out" });
};

/**
 * TOKEN STATUS — GET /api/auth/token-status
 * Header: Authorization Bearer <token> (or cookie token)
 * Same check as protect (middleware/auth inspectSessionToken)
 */
const tokenStatus = async (req, res) => {
  try {
    const token = readToken(req);
    const check = await inspectSessionToken(token);
    return res.status(token ? 200 : 400).json({
      message: check.message,
      isExpired: check.isExpired,
      isReplaced: check.isReplaced,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
      isExpired: false,
      isReplaced: false,
    });
  }
};

module.exports = { login, logout, tokenStatus };
