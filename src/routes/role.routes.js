/**
 * Role routes → /api/roles
 *
 * CRUD for roles and get/save of permission blocks.
 * Admin roles only (Super Admin, HR Manager, Manager).
 */
const express = require("express");
const {
  createRole,
  listRoles,
  getRole,
  updateRole,
  deleteRole,
  getPermissions,
  savePermissions,
} = require("../controllers/role.controller");
const { protect, authorize } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const {
  createRoleSchema,
  updateRoleSchema,
  savePermissionsSchema,
} = require("../validators/role.validation");

const router = express.Router();

const ADMIN = ["Super Admin", "HR Manager", "Manager"];


/**
 * @swagger
 * /api/roles:
 *   post:
 *     tags: [Roles]
 *     summary: Create role
 *     description: Creates role with default employee-level Module→SubModule permissions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Team Lead }
 *               description: { type: string, example: Team tasks }
 *               status: { type: string, enum: [Active, Inactive], example: Active }
 *     responses:
 *       201: { description: Role created }
 *       400: { description: Validation failed }
 */
router.post(
  "/",
  protect,
  authorize(...ADMIN),
  checkPermission("Administration", "Roles & Permissions", "create"),
  validate(createRoleSchema),
  createRole
);

/**
 * @swagger
 * /api/roles:
 *   get:
 *     tags: [Roles]
 *     summary: List roles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Role list }
 */
router.get(
  "/",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  listRoles
);

/**
 * @swagger
 * /api/roles/{id}/permissions:
 *   get:
 *     tags: [Permissions]
 *     summary: Get role permissions (Module → SubModule → Actions)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Permission matrix }
 */
router.get(
  "/:id/permissions",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  getPermissions
);

/**
 * @swagger
 * /api/roles/{id}/permissions:
 *   put:
 *     tags: [Permissions]
 *     summary: Save permissions
 *     description: |
 *       Flat block per heading:
 *       { module, heading, subModules: [ { name, view, create, … } ] }
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permissions]
 *             properties:
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [module, heading, subModules]
 *                   properties:
 *                     module: { type: string, example: Dashboard }
 *                     heading: { type: string, example: Overview }
 *                     subModules:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name: { type: string, example: Attendance Summary }
 *                           view: { type: boolean }
 *                           create: { type: boolean }
 *                           edit: { type: boolean }
 *                           delete: { type: boolean }
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Validation failed }
 */
router.put(
  "/:id/permissions",
  protect,
  authorize(...ADMIN),
  checkPermission("Administration", "Roles & Permissions", "edit"),
  validate(savePermissionsSchema),
  savePermissions
);

/**
 * @swagger
 * /api/roles/{id}:
 *   get:
 *     tags: [Roles]
 *     summary: Get one role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Role }
 */
router.get(
  "/:id",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  getRole
);

/**
 * @swagger
 * /api/roles/{id}:
 *   put:
 *     tags: [Roles]
 *     summary: Update role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               status: { type: string, enum: [Active, Inactive] }
 *     responses:
 *       200: { description: Updated }
 */
router.put(
  "/:id",
  protect,
  authorize(...ADMIN),
  checkPermission("Administration", "Roles & Permissions", "edit"),
  validate(updateRoleSchema),
  updateRole
);

/**
 * @swagger
 * /api/roles/{id}:
 *   delete:
 *     tags: [Roles]
 *     summary: Delete role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete(
  "/:id",
  protect,
  authorize("Super Admin"),
  checkPermission("Administration", "Roles & Permissions", "delete"),
  deleteRole
);

module.exports = router;
