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
  assignHrCompanies,
  sendUserMail,
} = require("../controllers/accessControl.controller");
const { protect, authorize } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const {
  createAccessUserSchema,
  updateAccessUserSchema,
  accessSendMailSchema,
  assignHrCompaniesSchema,
} = require("../validators/accessControl.validation");
const { assignReportingManager } = require("../controllers/reportingManager.controller");
const { assignManagerSchema } = require("../validators/reportingManager.validation");

const router = express.Router();

/** System names; custom admin roles also admitted by authorize + checkPermission */
const ACCESS_ROLES = require("../middleware/auth").ALL_ACCESS;

/**
 * @swagger
 * tags:
 *   - name: Admin / Users
 *     description: Access & Control — CRUD, export Excel, send mail
 */

/**
 * @swagger
 * /api/users/assign-manager:
 *   post:
 *     tags: [Admin / Users]
 *     summary: Bulk assign / remove Reporting Manager (company-wise)
 *     description: |
 *       Same API as POST /api/employees/assign-manager, for the Access & Control screen.
 *       Body `{ companyId, managerId, employeeIds, level? }` — `managerId: null` removes.
 *       Only Employee-role users of that company can get a manager; all-or-nothing checks.
 *       **Who:** Super Admin, Admin, HR Manager with Access & Control → assign.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated employees }
 *       400: { description: "errors[] per employee — nothing changed" }
 */
router.post(
  "/assign-manager",
  protect,
  authorize("Super Admin", "Admin", "HR Manager"),
  checkPermission("Administration", "Access & Control", "assign"),
  validate(assignManagerSchema),
  assignReportingManager
);

/**
 * @swagger
 * /api/users/{id}/assign-companies:
 *   post:
 *     tags: [Admin / Users]
 *     summary: Assign companies to an HR Manager (Super Admin)
 *     description: |
 *       Keeps `companyIds[0]` as the HR user's own company. Every other id is appended
 *       for access only: all branches, shifts and employees of that company.
 *       Response companies stay `{ _id, companyName }` — order is the rule, no extra flag.
 *       `branchId` and `shiftId` are not changed.
 *       **Who:** Super Admin only.
 *       **Target:** role must be HR Manager.
 *       Admin and Super Admin are not assigned companies — they already see every company.
 *       Employee and Reporting Manager stay on a single company (set on create / edit).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyIds]
 *             properties:
 *               companyIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string, example: "6ac4ca7070e8935d51b17035" }
 *     responses:
 *       200: { description: Companies assigned }
 *       400: { description: Not an HR Manager, or company not found }
 *       403: { description: Caller is not Super Admin }
 */
router.post(
  "/:id/assign-companies",
  protect,
  authorize("Super Admin"),
  checkPermission("Administration", "Access & Control", "assign"),
  validate(assignHrCompaniesSchema),
  assignHrCompanies
);

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
 *       Access & Control filters:
 *       - search — name, email, code, dept, role, company name
 *       - company / companyId — Company `_id` or exact name
 *         Super Admin/Admin: any company. HR: only assigned companies.
 *       - role, department, status, branch, shift, page, limit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, example: Vivek }
 *       - in: query
 *         name: role
 *         schema: { type: string, example: Employee }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *       - in: query
 *         name: company
 *         schema: { type: string }
 *         description: Company _id or name (alias of companyId)
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *         description: Company MongoId — Super Admin/Admin any; HR assigned only
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
