/**
 * Permission routes → /api/permissions
 *
 * Catalog of modules/actions and the current user's permission set.
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
 *     summary: Permission catalog (modules, actions, trees)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Catalog }
 */
router.get("/modules", protect, listModules);

/**
 * @swagger
 * /api/permissions/my:
 *   get:
 *     tags: [Permissions]
 *     summary: My permissions and menu
 *     description: Returns Module → Heading → SubModule action flags for the logged-in role
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: My permissions }
 */
router.get("/my", protect, myPermissions);

module.exports = router;
