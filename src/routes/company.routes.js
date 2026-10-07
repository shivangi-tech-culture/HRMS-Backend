/**
 * COMPANY ROUTES → /api/companies
 * Super Admin and Admin only.
 */
const express = require("express");
const {
  listCompanies,
  getCompany,
  listCompanyBranches,
  listCompanyBranchShifts,
  createCompany,
  updateCompany,
  deleteCompany,
} = require("../controllers/company.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { SUPER_ADMIN, ADMIN } = require("../config/roles");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createCompanySchema,
  updateCompanySchema,
  listCompanyQuerySchema,
} = require("../validators/company.validation");

const router = express.Router();
const companyRoles = [SUPER_ADMIN, ADMIN];

/**
 * @swagger
 * tags:
 *   - name: Admin / Company
 *     description: |
 *       Branch / shift names + codes are masters (`/api/masters?type=branch|shift`), shared by all companies.
 *       A company links them: branches[].branchId → shifts[].shiftId → monthlySchedule (days/times).
 *       Users save official.companyIds + one branchId + one shiftId (same master ids).
 *       Dropdown: GET /api/companies/{id}/branches then GET .../branches/{branchId}.
 *       **CRUD: Super Admin and Admin only.** HR can GET branches of assigned companies.
 */

/**
 * @swagger
 * /api/companies:
 *   get:
 *     tags: [Admin / Company]
 *     summary: List companies (Super Admin / Admin)
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
router.get(
  "/",
  protect,
  authorize(...companyRoles),
  checkPermission("Administration", "Company", "view"),
  validateQuery(listCompanyQuerySchema),
  listCompanies
);

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
 * /api/companies/{id}/branches/{branchId}:
 *   get:
 *     tags: [Admin / Company]
 *     summary: Shifts of one branch (create-user cascade)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/:id/branches/:branchId",
  protect,
  authorize(...ALL_ACCESS),
  listCompanyBranchShifts
);

/**
 * @swagger
 * /api/companies/{id}/branches:
 *   get:
 *     tags: [Admin / Company]
 *     summary: Company branches + shift names (create-user dropdown)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Active branches and their shifts }
 */
router.get(
  "/:id/branches",
  protect,
  authorize(...ALL_ACCESS),
  listCompanyBranches
);

/**
 * @swagger
 * /api/companies/{id}:
 *   get:
 *     tags: [Admin / Company]
 *     summary: Get one company
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Company }
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
router.get(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Administration", "Company", "view"),
  getCompany
);

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
