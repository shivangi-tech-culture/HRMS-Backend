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

/** System roles that manage other users, official{}, payroll, approvals */
const ALL_ACCESS = [
  "Global Admin",
  "Super Admin",
  "HR Manager",
  "Manager",
];

/** Gates that include these may also admit custom admin-side roles */
const DELEGATABLE_ADMIN = ["HR Manager", "Manager"];

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
 * Module allow/deny is separate — only granted actions pass checkPermission.
 */
const classifyRoleAccess = (roleName, permissions = [], catalog) => {
  if (ALL_ACCESS.includes(roleName)) {
    return { adminAccess: true, essAccess: false };
  }
  if (roleName === "Employee") {
    return { adminAccess: false, essAccess: true };
  }

  // Custom role: trust catalog chosen at create / last save
  if (catalog === "admin") {
    return { adminAccess: true, essAccess: false };
  }
  if (catalog === "employee") {
    return { adminAccess: false, essAccess: true };
  }

  // Legacy roles without catalog — infer from granted modules
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

const isSystemRoleName = (roleName) =>
  ALL_ACCESS.includes(roleName) || roleName === "Employee";

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

    const roleDoc = await Role.findOne({ name: user.role }).lean();
    const { adminAccess, essAccess } = classifyRoleAccess(
      user.role,
      roleDoc?.permissions,
      roleDoc?.catalog
    );

    // In-memory flags for authorize / hasAllAccess / profile permission routing
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
 * - Global/Super-only gates stay strict (no custom bypass).
 * - Gates that include HR Manager / Manager also admit custom adminAccess.
 * - Gates that include Employee also admit custom essAccess.
 * Action-level grants still come from checkPermission where used.
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Please login first" });
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    // System roles: exact name only (keeps Manager≠HR create, Super-only deletes, etc.)
    if (isSystemRoleName(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    const allowsDelegatedAdmin = allowedRoles.some((r) =>
      DELEGATABLE_ADMIN.includes(r)
    );
    if (allowsDelegatedAdmin && hasAllAccess(req.user)) {
      return next();
    }

    if (allowedRoles.includes("Employee") && req.user.essAccess === true) {
      return next();
    }

    return res.status(403).json({
      message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
    });
  };
};

/**
 * True for system ALL_ACCESS roles, or custom roles with admin-catalog grants.
 * Uses flag set in protect when present.
 */
const hasAllAccess = (user) => {
  if (!user) return false;
  if (typeof user.adminAccess === "boolean") return user.adminAccess;
  return ALL_ACCESS.includes(user.role);
};

module.exports = {
  protect,
  authorize,
  hasAllAccess,
  ALL_ACCESS,
  classifyRoleAccess,
};
