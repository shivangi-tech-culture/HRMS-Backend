/**
 * AUTH MIDDLEWARE — JWT protect + role authorize
 * protect → cookie/Bearer JWT → req.user (+ admin/ESS flags from Role matrix)
 * authorize(...roles) → system role names OR custom roles with matching side
 * checkPermission (routes) still enforces the actual action grants.
 */
const User = require("../models/User");
const Role = require("../models/Role");
const { readToken } = require("../utils/authCookie");
const { verifyToken } = require("../utils/jwt");
const {
  ALL_ACCESS,
  DELEGATABLE_ADMIN,
  EMPLOYEE,
  normalizeRoleName,
  SYSTEM_ROLES,
} = require("../config/roles");

/** Admin-catalog modules (not ESS Self/Team/Request/Tasks) */
const ADMIN_ONLY_MODULES = new Set([
  "Employee",
  "Attendance",
  "Break",
  "Leave",
  "Payroll",
  "Approvals",
  "Organization",
  "Masters",
  "Work",
  "Reports",
  "Communication",
  "Administration",
]);

/** ESS-catalog modules (distinct from admin) */
const ESS_ONLY_MODULES = new Set(["Self", "Team", "Request", "Tasks"]);

const ACTION_KEYS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "reject",
  "download",
  "export",
  "import",
  "upload",
  "print",
  "email",
  "share",
  "cancel",
  "assign",
];

const blockHasGrant = (block) =>
  (block.subModules || []).some((sub) =>
    ACTION_KEYS.some((k) => sub[k] === true)
  );

/**
 * Classify role from name + catalog + stored permissions.
 * catalog (admin|employee) from create wins for custom roles.
 */
const classifyRoleAccess = (roleName, permissions = [], catalog) => {
  const role = normalizeRoleName(roleName);
  if (ALL_ACCESS.includes(role)) {
    return { adminAccess: true, essAccess: false };
  }
  if (role === EMPLOYEE) {
    return { adminAccess: false, essAccess: true };
  }

  if (catalog === "admin") {
    return { adminAccess: true, essAccess: false };
  }
  if (catalog === "employee") {
    return { adminAccess: false, essAccess: true };
  }

  const hasAdmin = (permissions || []).some(
    (p) => ADMIN_ONLY_MODULES.has(p.module) && blockHasGrant(p)
  );
  const hasEss = (permissions || []).some(
    (p) => ESS_ONLY_MODULES.has(p.module) && blockHasGrant(p)
  );

  if (hasAdmin) return { adminAccess: true, essAccess: false };
  if (hasEss) return { adminAccess: false, essAccess: true };
  return { adminAccess: false, essAccess: false };
};

const isSystemRoleName = (roleName) => {
  const role = normalizeRoleName(roleName);
  return SYSTEM_ROLES.includes(role) || ALL_ACCESS.includes(role);
};

/** Require login — JWT from cookie or Bearer → req.user */
const protect = async (req, res, next) => {
  try {
    const token = readToken(req);
    if (!token) {
      return res.status(401).json({ message: "Please login first" });
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.status !== "Active") {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    // Normalize legacy role names in-memory for this request
    const normalized = normalizeRoleName(user.role);
    if (normalized !== user.role) {
      user.role = normalized;
    }

    const roleDoc = await Role.findOne({
      name: { $in: [user.role, normalized] },
    }).lean();
    const { adminAccess, essAccess } = classifyRoleAccess(
      user.role,
      roleDoc?.permissions,
      roleDoc?.catalog
    );

    user.adminAccess = adminAccess;
    user.essAccess = essAccess;
    req.roleDoc = roleDoc || null;
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Allow listed system roles, or custom roles on the same side.
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Please login first" });
    }

    const userRole = normalizeRoleName(req.user.role);
    const allowed = allowedRoles.map(normalizeRoleName);

    if (allowed.includes(userRole)) {
      return next();
    }

    if (isSystemRoleName(userRole)) {
      return res.status(403).json({
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    const allowsDelegatedAdmin = allowed.some((r) =>
      DELEGATABLE_ADMIN.includes(r)
    );
    if (allowsDelegatedAdmin && hasAllAccess(req.user)) {
      return next();
    }

    if (allowed.includes(EMPLOYEE) && req.user.essAccess === true) {
      return next();
    }

    return res.status(403).json({
      message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
    });
  };
};

const hasAllAccess = (user) => {
  if (!user) return false;
  if (typeof user.adminAccess === "boolean") return user.adminAccess;
  return ALL_ACCESS.includes(normalizeRoleName(user.role));
};

module.exports = {
  protect,
  authorize,
  hasAllAccess,
  ALL_ACCESS,
  classifyRoleAccess,
};
