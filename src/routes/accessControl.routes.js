/**
 * ACCESS & CONTROL ROUTES — /api/users
 * CRUD + export Excel + send mail.
 * Permissions: Administration → Access & Control → view|create|edit|delete|export|email
 */
const express = require("express");
const {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  exportUsers,
  sendUserMail,
} = require("../controllers/accessControl.controller");
const { protect, authorize } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const {
  createAccessUserSchema,
  updateAccessUserSchema,
  accessSendMailSchema,
} = require("../validators/accessControl.validation");

const router = express.Router();

/** System names; custom admin roles also admitted by authorize + checkPermission */
const ACCESS_ROLES = ["Global Admin", "Super Admin", "HR Manager", "Manager"];

/**
 * @swagger
 * tags:
 *   - name: Admin / Users
 *     description: Access & Control — CRUD, export Excel, send mail
 */

/**
 * @swagger
 * /api/users:
 *   post:
 *     tags: [Admin / Users]
 *     summary: Create user (Access & Control)
 *     description: |
 *       Lean drawer fields. `official.employeeCode` optional (editable, unique when set).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: User created }
 *       403: { description: No create permission }
 */
router.post(
  "/",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "create"),
  validate(createAccessUserSchema),
  createUser
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [Admin / Users]
 *     summary: List users (search + filters + pagination)
 *     description: |
 *       Access & Control table filters (UI):
 *       - **search** / q — name, email, department, role, company
 *       - **role** — All roles dropdown (ignore "All roles")
 *       - **department** — All departments
 *       - **company** — All companies
 *       - **status** — Active | Inactive
 *       - page, limit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, example: Vivek }
 *         description: Search name, email, department, role, company
 *       - in: query
 *         name: role
 *         schema: { type: string, example: Super Admin }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 *       - in: query
 *         name: department
 *         schema: { type: string, example: Engineering }
 *       - in: query
 *         name: company
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Paginated users }
 */
router.get(
  "/",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "view"),
  listUsers
);

/**
 * @swagger
 * /api/users/export:
 *   get:
 *     tags: [Admin / Users]
 *     summary: Export users Excel (Access & Control → export)
 *     description: Same filters as list. Admin roles only (not Employee).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: .xlsx file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get(
  "/export",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "export"),
  exportUsers
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags: [Admin / Users]
 *     summary: Get one user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: User }
 */
router.get(
  "/:id",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "view"),
  getUser
);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     tags: [Admin / Users]
 *     summary: Update user (Edit drawer)
 *     description: |
 *       Email + company locked. `official.employeeCode` optional — send to set/clear/edit.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Updated }
 */
router.put(
  "/:id",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "edit"),
  validate(updateAccessUserSchema),
  updateUser
);

/**
 * @swagger
 * /api/users/{id}/mail:
 *   post:
 *     tags: [Admin / Users]
 *     summary: Send mail to user (row mail icon)
 *     description: Uses user's officialEmail. Permission Access & Control → email
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, body]
 *             properties:
 *               subject: { type: string }
 *               body: { type: string }
 *               isHtml: { type: boolean, default: false }
 *     responses:
 *       200: { description: Email sent }
 */
router.post(
  "/:id/mail",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "email"),
  validate(accessSendMailSchema),
  sendUserMail
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     tags: [Admin / Users]
 *     summary: Delete user (separate delete API)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Cannot delete self }
 */
router.delete(
  "/:id",
  protect,
  authorize(...ACCESS_ROLES),
  checkPermission("Administration", "Access & Control", "delete"),
  deleteUser
);

module.exports = router;
