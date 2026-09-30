/**
 * ROLE ROUTES → /api/roles
 * Role CRUD + get/save permissions
 */
const express = require("express");
const {
  createRole,
  listRoles,
  getRole,
  deleteRole,
  getPermissions,
  savePermissions,
  getHierarchy,
} = require("../controllers/role.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const {
  createRoleSchema,
  savePermissionsSchema,
} = require("../validators/role.validation");
const { SUPER_ADMIN, ADMIN } = require("../config/roles");

const router = express.Router();

/** System admin names; custom admin roles also admitted by authorize */
const ADMIN_ROLES = ALL_ACCESS;
const PLATFORM = [SUPER_ADMIN, ADMIN];

/**
 * @swagger
 * /api/roles:
 *   post:
 *     tags: [Admin / Roles]
 *     summary: Create role with admin permissions (hide/show)
 *     description: |
 *       Always uses **admin** permission catalog (not employee ESS).
 *       1. `GET /api/permissions/modules` → use `side: admin` only
 *       2. Hide modules you don't want (omit or all actions false)
 *       3. `POST /api/roles` with `permissions` (catalog optional — forced admin)
 *       Later: `PUT /api/roles/:id/permissions` to hide/show again.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRoleBody'
 *     responses:
 *       201: { description: Role created }
 *       400: { description: Validation failed }
 */
// CREATE ROLE
router.post(
  "/",
  protect,
  authorize(...ADMIN_ROLES),
  checkPermission("Administration", "Roles & Permissions", "create"),
  validate(createRoleSchema),
  createRole
);

/**
 * @swagger
 * /api/roles:
 *   get:
 *     tags: [Admin / Roles]
 *     summary: List roles
 *     description: |
 *       **Global Admin** login → sees Global Admin in the list (can create more platform owners).
 *       **Super Admin / HR / Manager** → Global Admin is **hidden** (cannot escalate).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Role list (Global Admin only for Global Admin actors) }
 */
// LIST ROLES
router.get(
  "/",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  listRoles
);

/**
 * @swagger
 * /api/roles/hierarchy:
 *   get:
 *     tags: [Admin / Roles]
 *     summary: Role hierarchy ladder (easy overview)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/hierarchy",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  getHierarchy
);

/**
 * @swagger
 * /api/roles/{id}/permissions:
 *   get:
 *     tags: [Admin / Permissions]
 *     summary: Get role permissions (Module → SubModule → Actions)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/RoleId'
 *     responses:
 *       200: { description: Permission matrix }
 */
// GET PERMISSIONS for one role
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
 *     tags: [Admin / Permissions]
 *     summary: Update permissions (hide / show modules)
 *     description: |
 *       Re-decide grants for Employee, HR Manager, Manager, and custom roles.
 *       Super Admin / Global Admin locked (full access).
 *       Only **true** actions are stored in DB — omit or set false to hide.
 *       Body: { catalog?: admin|employee, permissions: [ { module, heading, subModules: […] } ] }
 *       Routes enforce via checkPermission against this saved matrix.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/RoleId'
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
 *                         $ref: '#/components/schemas/PermissionActionFlags'
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Validation failed }
 */
// SAVE PERMISSIONS — Module → SubModule → action flags
router.put(
  "/:id/permissions",
  protect,
  authorize(...ADMIN_ROLES),
  checkPermission("Administration", "Roles & Permissions", "edit"),
  validate(savePermissionsSchema),
  savePermissions
);

/**
 * @swagger
 * /api/roles/{id}:
 *   get:
 *     tags: [Admin / Roles]
 *     summary: Get one role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/RoleId'
 *     responses:
 *       200: { description: Role }
 */
// GET ONE ROLE by id
router.get(
  "/:id",
  protect,
  checkPermission("Administration", "Roles & Permissions", "view"),
  getRole
);

/**
 * @swagger
 * /api/roles/{id}:
 *   delete:
 *     tags: [Admin / Roles]
 *     summary: Delete role
 *     description: |
 *       Super Admin cannot be deleted.
 *       Employee, HR Manager, Manager, and custom roles can be deleted when no user still has that role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/RoleId'
 *     responses:
 *       200: { description: Deleted }
 */
// DELETE ROLE — Super Admin / Admin only
router.delete(
  "/:id",
  protect,
  authorize(...PLATFORM),
  checkPermission("Administration", "Roles & Permissions", "delete"),
  deleteRole
);

module.exports = router;
