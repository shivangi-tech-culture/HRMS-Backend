/**
 * COMPANY ROUTES → /api/companies
 * Super Admin and Admin only.
 * HR, Reporting Manager, Employee, and custom roles are denied
 * (Company is not in their permission catalog).
 * Super Admin is not created by Admin — see Access & Control.
 */
const express = require("express");
const {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} = require("../controllers/company.controller");
const { protect, authorize } = require("../middleware/auth");
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
 *       Company org setup (branches → shifts → monthly schedule).
 *       **Super Admin and Admin only.** HR and other roles have no Company module.
 *       Super Admin is not created by Admin.
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
 *         description: Match company name or code
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
 *       403: { description: HR and other roles cannot access Company }
 *   post:
 *     tags: [Admin / Company]
 *     summary: Create company with branches, shifts, and weekly schedule
 *     description: Super Admin and Admin. HR has no create access.
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
 *                   required: [branchName, branchCode]
 *                   properties:
 *                     branchName: { type: string, example: Noida Branch }
 *                     branchCode: { type: string, example: NOI }
 *                     address: { type: string }
 *                     city: { type: string }
 *                     state: { type: string }
 *                     isActive: { type: boolean }
 *                     shifts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [shiftName, shiftCode]
 *                         properties:
 *                           shiftName: { type: string, example: General Shift }
 *                           shiftCode: { type: string, example: GS-01 }
 *                           isActive: { type: boolean }
 *                           monthlySchedule:
 *                             type: array
 *                             items:
 *                               type: object
 *                               required: [weekNumber, days]
 *                               properties:
 *                                 weekNumber: { type: integer, minimum: 1, maximum: 5 }
 *                                 days:
 *                                   type: array
 *                                   description: All 7 weekdays. isOff true may omit times.
 *                                   items:
 *                                     type: object
 *                                     properties:
 *                                       day:
 *                                         type: string
 *                                         enum: [monday, tuesday, wednesday, thursday, friday, saturday, sunday]
 *                                       isOff: { type: boolean }
 *                                       startTime: { type: string, example: "09:00" }
 *                                       endTime: { type: string, example: "18:00" }
 *                                       breakStartTime: { type: string, example: "13:00" }
 *                                       breakEndTime: { type: string, example: "13:30" }
 *     responses:
 *       201: { description: Company created }
 *       403: { description: Not Super Admin or Admin }
 *       409: { description: Duplicate company name or code }
 */
router.get(
  "/",
  protect,
  authorize(...companyRoles),
  checkPermission("Company", "Company", "view"),
  validateQuery(listCompanyQuerySchema),
  listCompanies
);

router.post(
  "/",
  protect,
  authorize(...companyRoles),
  checkPermission("Company", "Company", "create"),
  validate(createCompanySchema),
  createCompany
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
 *     summary: Update company (send full branches array to replace schedule)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *       403: { description: Not Super Admin or Admin }
 *   delete:
 *     tags: [Admin / Company]
 *     summary: Delete company
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Not Super Admin or Admin }
 */
router.get(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Company", "Company", "view"),
  getCompany
);

router.put(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Company", "Company", "edit"),
  validate(updateCompanySchema),
  updateCompany
);

router.delete(
  "/:id",
  protect,
  authorize(...companyRoles),
  checkPermission("Company", "Company", "delete"),
  deleteCompany
);

module.exports = router;
