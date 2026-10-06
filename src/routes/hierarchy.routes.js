/**
 * HIERARCHY ROUTES — /api/hierarchy
 * Permission: Administration → Hierarchy (view | assign)
 *
 * Super Admin / Admin / HR Manager → full organization tree + assign / unassign
 * Reporting Manager                → own hierarchy only (self + team), view only
 * Employee                         → no access
 */
const express = require("express");
const {
  getOverview,
  getTree,
  listReportingManagers,
  getReportingManagerTeam,
  getSuperAdminView,
  assignEmployees,
  unassignEmployees,
} = require("../controllers/hierarchy.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { SUPER_ADMIN, ADMIN, HR } = require("../config/roles");
const { validate } = require("../middleware/validate");
const {
  assignSchema,
  unassignSchema,
} = require("../validators/hierarchy.validation");

const router = express.Router();

const canView = [
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Administration", "Hierarchy", "view"),
];
const canAssign = [
  protect,
  authorize(SUPER_ADMIN, ADMIN, HR),
  checkPermission("Administration", "Hierarchy", "assign"),
];

/**
 * @swagger
 * tags:
 *   - name: Admin / Hierarchy
 *     description: |
 *       Administration → Hierarchy. Super Admin / Admin / HR see the full organization;
 *       a Reporting Manager sees only their own hierarchy (self + team).
 *       reportingHead1 / reportingHead2 are User _ids, assigned manually.
 */

/**
 * @swagger
 * /api/hierarchy:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Role ladder overview + users per level
 *     description: Reporting Manager → only self and own team appear in the levels.
 *     security:
 *       - bearerAuth: []
 */
router.get("/", ...canView, getOverview);

/**
 * @swagger
 * /api/hierarchy/tree:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Organization tree (Tree View)
 *     description: |
 *       Super Admin / Admin / HR → full tree from Super Admin down.
 *       Reporting Manager → tree rooted at themselves with their team as children.
 *     security:
 *       - bearerAuth: []
 */
router.get("/tree", ...canView, getTree);

/**
 * @swagger
 * /api/hierarchy/super-admin:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Branches under Super Admin (Admins / HR / Reporting Managers)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/super-admin",
  protect,
  authorize(SUPER_ADMIN, ADMIN, HR),
  checkPermission("Administration", "Hierarchy", "view"),
  getSuperAdminView
);

/**
 * @swagger
 * /api/hierarchy/reporting-managers:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Reporting Managers with team counts
 *     description: Reporting Manager → only themselves.
 *     security:
 *       - bearerAuth: []
 */
router.get("/reporting-managers", ...canView, listReportingManagers);

/**
 * @swagger
 * /api/hierarchy/reporting-managers/{id}:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: One Reporting Manager → team
 *     description: Reporting Manager may open only their own id.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get("/reporting-managers/:id", ...canView, getReportingManagerTeam);

/**
 * @swagger
 * /api/hierarchy/assign:
 *   post:
 *     tags: [Admin / Hierarchy]
 *     summary: Assign employees to a Reporting Manager (manual, bulk)
 *     description: |
 *       Permission: Administration → Hierarchy → assign (Super Admin / Admin / HR).
 *       Sets official.reportingHead1 (level 1, default) or reportingHead2 (level 2)
 *       to managerId for every employee. Company is not used to choose the manager.
 *       All-or-nothing — if any employee is invalid, nothing changes.
 *       HR Manager can assign only employees of their own companies.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [managerId, employeeIds]
 *             properties:
 *               managerId:
 *                 type: string
 *                 example: 6ac4b3e4d269e78d0eae7f64
 *               employeeIds:
 *                 type: array
 *                 items: { type: string }
 *                 example: [6ac4b3e7d269e78d0eae7f66, 6ac4b3f2d269e78d0eae7f68]
 *               level:
 *                 type: integer
 *                 enum: [1, 2]
 *                 default: 1
 *     responses:
 *       200:
 *         description: Employees with populated reportingHead1 / reportingHead2
 *       400:
 *         description: Invalid manager or employees — errors[] lists each one
 *       404:
 *         description: Some employeeIds not found
 */
router.post("/assign", ...canAssign, validate(assignSchema), assignEmployees);

/**
 * @swagger
 * /api/hierarchy/unassign:
 *   post:
 *     tags: [Admin / Hierarchy]
 *     summary: Remove reporting manager from employees (bulk)
 *     description: |
 *       Permission: Administration → Hierarchy → assign.
 *       managerId → clear only heads pointing to that manager (remove from their team).
 *       level (1 | 2) → clear that head. Neither → clear both heads.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeIds]
 *             properties:
 *               employeeIds:
 *                 type: array
 *                 items: { type: string }
 *               managerId: { type: string }
 *               level: { type: integer, enum: [1, 2] }
 */
router.post(
  "/unassign",
  ...canAssign,
  validate(unassignSchema),
  unassignEmployees
);

module.exports = router;
