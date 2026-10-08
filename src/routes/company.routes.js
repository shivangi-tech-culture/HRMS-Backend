/**
 * COMPANY ROUTES → /api/companies — plain CRUD (5 APIs)
 * Create / Update / Delete: Super Admin and Admin only.
 * List / Get: Super Admin and Admin (all companies); HR / Reporting Manager (own companies only).
 */
const express = require("express");
const {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} = require("../controllers/company.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { SUPER_ADMIN, ADMIN } = require("../config/roles");
const { hasGlobalCompanyAccess } = require("../utils/companyScope");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createCompanySchema,
  updateCompanySchema,
  listCompanyQuerySchema,
} = require("../validators/company.validation");

const router = express.Router();
const companyRoles = [SUPER_ADMIN, ADMIN];

/** Company permission exists only for Super Admin / Admin; others read their own companies. */
const canView = [
  protect,
  authorize(...ALL_ACCESS),
  (req, res, next) =>
    hasGlobalCompanyAccess(req.user)
      ? checkPermission("Administration", "Company", "view")(req, res, next)
      : next(),
];

/**
 * @swagger
 * tags:
 *   - name: Admin / Company
 *     description: |
 *       Plain CRUD. Branch / shift names + codes are masters (`/api/masters?type=branch|shift`).
 *       A company links them: branches[].branchId → shifts[].shiftId → monthlySchedule (days/times).
 *       GET /api/companies/{id} = full company details (branches → shifts → monthlySchedule + reportingManagers)
 *       — use it for create-employee dropdowns too.
 *       **Create / Update / Delete: Super Admin and Admin.**
 *       **List / Get:** Super Admin and Admin see every company (`scope: all`).
 *       HR sees every company stored on them (`scope: assigned`) — own company plus assigned companies
 *       (all branches, shifts and employees of those companies).
 */

/**
 * @swagger
 * /api/companies:
 *   get:
 *     tags: [Admin / Company]
 *     summary: List companies
 *     description: |
 *       Super Admin and Admin → every company (`scope: all`).
 *       HR Manager → every company on their companyIds (`scope: assigned`):
 *       index 0 is their own, later ids are assigned access (all branches, shifts, employees).
 *       Reporting Manager and Employee → their one company.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Paginated companies }
 *   post:
 *     tags: [Admin / Company]
 *     summary: Create company
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyName, companyCode]
 *             properties:
 *               companyName: { type: string, example: ABC Technologies }
 *               companyCode: { type: string, example: ABC }
 *               isActive: { type: boolean, example: true }
 *               branches:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [branchId]
 *                   properties:
 *                     branchId: { type: string, description: Branch master _id, example: 6ac4e6585473cbef581c18cf }
 *                     address: { type: string, example: Sector 62 }
 *                     city: { type: string, example: Noida }
 *                     state: { type: string, example: Uttar Pradesh }
 *                     isActive: { type: boolean, example: true }
 *                     shifts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [shiftId]
 *                         properties:
 *                           shiftId: { type: string, description: Shift master _id, example: 6ac4e6585473cbef581c18d0 }
 *                           isActive: { type: boolean, example: true }
 *                           monthlySchedule:
 *                             type: array
 *                             description: weekNumber 1-5; each week must include all 7 days
 *     responses:
 *       201: { description: "Company created (branchId / shiftId populated to { _id, name, code })" }
 *       400: { description: "Unknown branch / shift master id or invalid schedule" }
 *       409: { description: Duplicate company name or code }
 */
router.get("/", ...canView, validateQuery(listCompanyQuerySchema), listCompanies);

router.post(
  "/",
  protect,
  authorize(...companyRoles),
  checkPermission("Administration", "Company", "create"),
  validate(createCompanySchema),
  createCompany
);

/**
 * @swagger
 * /api/companies/{id}:
 *   get:
 *     tags: [Admin / Company]
 *     summary: Get one company — all details
 *     description: |
 *       Everything about the company in one call: companyName, companyCode, isActive,
 *       branches[] (branchId { _id, name, code }, address, city, state, isActive,
 *       shifts[] (shiftId { _id, name, code }, isActive, monthlySchedule)) and
 *       reportingManagers[] { _id, name, employeeCode, email } (active managers of this company).
 *       Create-employee form: companyIds ← _id, branchId ← branches[].branchId._id,
 *       shiftId ← shifts[].shiftId._id, reportingHead1 ← reportingManagers[]._id.
 *       HR / Reporting Manager → own companies only (403 otherwise).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Company with branches, shifts, schedule and reportingManagers }
 *       403: { description: Not your company }
 *       404: { description: Not found }
 *   put:
 *     tags: [Admin / Company]
 *     summary: Update company
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     tags: [Admin / Company]
 *     summary: Delete company
 *     description: Blocked (409) while users still reference it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Company still in use }
 */
router.get("/:id", ...canView, getCompany);

router.put(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Administration", "Company", "edit"),
  validate(updateCompanySchema),
  updateCompany
);

router.delete(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Administration", "Company", "delete"),
  deleteCompany
);

module.exports = router;
