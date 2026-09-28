/**
 * PERMISSION ROUTES → /api/permissions
 * Catalog (admin + employee) for Create Role UI + my permissions
 */
const express = require("express");
const {
  listModules,
  myPermissions,
} = require("../controllers/permission.controller");
const { protect } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Permissions
 *     description: Catalogs for Create Role (admin + employee trees)
 */

/**
 * @swagger
 * /api/permissions/modules:
 *   get:
 *     tags: [Admin / Permissions]
 *     summary: Get all permission catalogs (admin + employee)
 *     description: |
 *       Used on **Create Role / Edit Permissions** screen.
 *       Returns **both** trees so admin can pick modules to attach:
 *       - `side: admin` → Super Admin / HR / Manager catalog
 *       - `side: employee` → Employee ESS catalog
 *       Select actions → send as `permissions` on create or PUT /api/roles/:id/permissions.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Both catalogs + action list
 */
router.get(
  "/modules",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  listModules
);

/**
 * @swagger
 * /api/permissions/my:
 *   get:
 *     tags: [Employee / ESS]
 *     summary: My role permissions (compact)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Logged-in user role matrix }
 */
router.get("/my", protect, myPermissions);

module.exports = router;
