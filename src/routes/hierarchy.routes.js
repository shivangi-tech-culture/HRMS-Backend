/**
 * HIERARCHY ROUTES — /api/hierarchy (one API)
 * Permission: Administration → Hierarchy → view
 *
 * Super Admin / Admin / HR Manager → whole hierarchy (HR = own companies)
 * Reporting Manager                → own hierarchy only (self + team)
 * Employee                         → no access
 * Assign manager → POST /api/employees/assign-manager or POST /api/users/assign-manager
 */
const express = require("express");
const { getHierarchy } = require("../controllers/hierarchy.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Hierarchy
 *     description: |
 *       One API. Super Admin / Admin / HR see the whole hierarchy;
 *       a Reporting Manager sees only their own (self + team).
 */

/**
 * @swagger
 * /api/hierarchy:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Hierarchy tree — Super Admin → Admin → HR Manager → Reporting Manager → Employee
 *     description: |
 *       `tree` is nested. Each role node = `{ level, role, label, count, users[], children[] }`,
 *       where `children[]` holds the next role down. Every Reporting Manager in `users[]` has
 *       `teamCount` + `children[]` = their employees (`reportingLevel` 1 = primary, 2 = secondary).
 *       `unassignedEmployees[]` = employees with no reporting manager.
 *       **Super Admin / Admin** → all companies (or one with companyId).
 *       **HR Manager** → own companies only.
 *       **Reporting Manager** → `scope: team` — tree rooted at "Me" with their team. companyId ignored.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *         description: Company _id or company name. Omit = all companies.
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 */
router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Administration", "Hierarchy", "view"),
  getHierarchy
);

module.exports = router;
