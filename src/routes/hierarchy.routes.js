/**
 * HIERARCHY ROUTES — /api/hierarchy
 * Organization tree for Super Admin / Admin / HR / Reporting Manager
 */
const express = require("express");
const {
  getOverview,
  getTree,
  listReportingManagers,
  getReportingManagerTeam,
  getSuperAdminView,
} = require("../controllers/hierarchy.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { SUPER_ADMIN, ADMIN } = require("../config/roles");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Hierarchy
 *     description: Organization tree — Super Admin → Admin → HR / Reporting Manager → Employee
 */

/**
 * @swagger
 * /api/hierarchy:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Role ladder overview + users per level
 *     security:
 *       - bearerAuth: []
 */
router.get("/", protect, authorize(...ALL_ACCESS), getOverview);

/**
 * @swagger
 * /api/hierarchy/tree:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Full organization tree (Tree View)
 *     security:
 *       - bearerAuth: []
 */
router.get("/tree", protect, authorize(...ALL_ACCESS), getTree);

/**
 * @swagger
 * /api/hierarchy/super-admin:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Super Admin hierarchy branches (Admin / HR / RM)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/super-admin",
  protect,
  authorize(SUPER_ADMIN, ADMIN),
  getSuperAdminView
);

/**
 * @swagger
 * /api/hierarchy/reporting-managers:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: Reporting Managers list with team counts (Manager Hierarchy strip)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/reporting-managers",
  protect,
  authorize(...ALL_ACCESS),
  listReportingManagers
);

/**
 * @swagger
 * /api/hierarchy/reporting-managers/{id}:
 *   get:
 *     tags: [Admin / Hierarchy]
 *     summary: One Reporting Manager → team (Step 1 / Step 2)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/reporting-managers/:id",
  protect,
  authorize(...ALL_ACCESS),
  getReportingManagerTeam
);

module.exports = router;
