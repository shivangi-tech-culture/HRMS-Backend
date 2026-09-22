/**
 * Auth middleware
 *
 * protect   — require a valid JWT and attach req.user
 * authorize — allow only the listed roles
 * hasAllAccess — Super Admin / HR Manager / Manager
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");

/** Roles with full admin-side access */
const ALL_ACCESS = ["Super Admin", "HR Manager", "Manager"];

/**
 * Require login. Reads Bearer token, loads Active user into req.user.
 */
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Please login first" });
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user || user.status !== "Active") {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Role guard — place on routes after protect.
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

/** True when user is Super Admin, HR Manager, or Manager */
const hasAllAccess = (user) => ALL_ACCESS.includes(user.role);

module.exports = { protect, authorize, hasAllAccess, ALL_ACCESS };
