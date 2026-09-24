/**
 * Auth middleware — security layer for protected APIs
 *
 * protect(req, res, next)
 *   → checks Authorization: Bearer <token>
 *   → loads user into req.user
 *   → blocks missing / bad / inactive users
 *
 * authorize("Super Admin", "HR Manager", …)
 *   → after protect; only listed roles may continue
 *
 * hasAllAccess(user)
 *   → true for Global Admin / Super Admin / HR Manager / Manager
 *
 * ALL_ACCESS
 *   → admin roles as an array (spread into authorize)
 *
 * Roles (company scope):
 *   Global Admin → all companies
 *   Super Admin / HR Manager / Manager → own company only
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");

/** Roles that can manage other users, official{}, payroll, approvals */
const ALL_ACCESS = [
  "Global Admin",
  "Super Admin",
  "HR Manager",
  "Manager",
];

/**
 * Must be logged in.
 * 1. Read Bearer token from header
 * 2. Verify JWT with JWT_SECRET
 * 3. Load Active user (without password)
 * 4. Set req.user and call next()
 */
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    // Header must look like: "Bearer eyJhbGciOi…"
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Please login first" });
    }

    const token = header.split(" ")[1]; // take the token part only
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // { id: userId }
    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.status !== "Active") {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = user; // available in every later handler
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Role check. Use after protect.
 * Example: authorize("Super Admin", "HR Manager")
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Please login first" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }
    next();
  };
};

/** Shortcut: is this user an admin-side role? */
const hasAllAccess = (user) => ALL_ACCESS.includes(user.role);

module.exports = { protect, authorize, hasAllAccess, ALL_ACCESS };
