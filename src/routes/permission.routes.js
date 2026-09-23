/**
 * Permission routes → /api/permissions
 *
 * GET /modules → catalog: 2 sides (admin + employee), side once each
 * GET /my      → my permissions as data[] (no menu)
 */
const express = require("express");
const { listModules, myPermissions } = require("../controllers/permission.controller");
const { protect } = require("../middleware/auth");

const router = express.Router();

/**
 * @swagger
 * /api/permissions/modules:
 *   get:
 *     tags: [Permissions]
 *     summary: Permission catalog (admin + employee)
 *     description: |
 *       Returns **2 items** in `data` — `side` once per group:
 *
 *       - `{ side: "admin", modules: [...] }` → Super Admin / HR / Manager
 *       - `{ side: "employee", modules: [...] }` → Employee ESS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Catalog
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PermissionsCatalogResponse'
 */
router.get("/modules", protect, listModules);

/**
 * @swagger
 * /api/permissions/my:
 *   get:
 *     tags: [Permissions]
 *     summary: My permissions
 *     description: |
 *       One list only (no duplicate menu):
 *       `{ role, side, permissionCount, count, data }`
 *       Sidebar: use subModules where `view === true`.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MyPermissionsResponse'
 */
router.get("/my", protect, myPermissions);

module.exports = router;
