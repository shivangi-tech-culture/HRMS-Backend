/**
 * DASHBOARD ROUTES → /api/dashboard
 * Employee home widgets (ESS Dashboard → My Home).
 */
const express = require("express");
const { employeeDashboard } = require("../controllers/dashboard.controller");
const { protect } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");

const router = express.Router();

const employeeOnly = (req, res, next) => {
  if (normalizeRoleName(req.user.role) !== EMPLOYEE) {
    return res.status(403).json({ message: "Employee only" });
  }
  return next();
};

/**
 * @swagger
 * tags:
 *   - name: Employee Dashboard
 *     description: ESS home widgets — attendance, tasks, leaves, events
 */

/**
 * @swagger
 * /api/dashboard/employee:
 *   get:
 *     tags: [Employee Dashboard]
 *     summary: Employee home dashboard (My Home)
 *     description: |
 *       Aggregates widgets for `/employee`:
 *       greeting, summary counts, today attendance, monthly stats,
 *       weekly working hours, pending tasks, leaves/holidays, events,
 *       notifications unread, profile completion, important links.
 *       Permission: **Dashboard → My Home → view**.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard payload
 *       403:
 *         description: Not an employee / missing permission
 */
router.get(
  "/employee",
  protect,
  employeeOnly,
  checkPermission("Dashboard", "My Home", "view"),
  employeeDashboard
);

module.exports = router;
