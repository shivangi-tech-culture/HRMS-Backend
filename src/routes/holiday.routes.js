/**
 * HOLIDAY ROUTES → /api/holidays
 * Create the catalog, then assign companies with POST /assign.
 * Admin permission: Administration → Holiday → view | create | edit | delete
 * Employee list: Self → Holiday → view (GET /me)
 */
const express = require("express");
const {
  listHolidays,
  getHoliday,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  assignHolidays,
  myHolidays,
} = require("../controllers/holiday.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");
const {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidayQuerySchema,
  myHolidayQuerySchema,
  assignHolidaySchema,
} = require("../validators/holiday.validation");

const router = express.Router();

const gate = (action) => [
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Administration", "Holiday", action),
];

const employeeOnly = (req, res, next) => {
  if (normalizeRoleName(req.user.role) !== EMPLOYEE) {
    return res.status(403).json({ message: "Employee only" });
  }
  return next();
};

/**
 * @swagger
 * tags:
 *   - name: Work / Holiday
 *     description: |
 *       Holiday catalog (`name`, `date`, `description`, `isActive`), then assign companies.
 *       One holiday row. `companyIds` says which companies get that day off.
 *       POST /api/holidays/assign assigns many holidays to many companies (`mode` add | remove | replace).
 */

/**
 * @swagger
 * /api/holidays:
 *   get:
 *     tags: [Work / Holiday]
 *     summary: List holidays
 *     description: |
 *       Super Admin and Admin see every holiday.
 *       Other roles see holidays assigned to their companies.
 *       `companyId` returns holidays assigned to that company.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *       - in: query
 *         name: year
 *         schema: { type: integer, example: 2026 }
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Paginated holidays with companyIds }
 *   post:
 *     tags: [Work / Holiday]
 *     summary: Create a holiday (no company yet)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, date]
 *             properties:
 *               name: { type: string, example: Republic Day }
 *               date: { type: string, example: "2026-01-26" }
 *               description: { type: string, example: "" }
 *               isActive: { type: boolean, example: true }
 *     responses:
 *       201: { description: "Holiday created with companyIds []" }
 *       409: { description: Date already used }
 */
/**
 * @swagger
 * /api/holidays/me:
 *   get:
 *     tags: [Work / Holiday]
 *     summary: Employee holiday list
 *     description: |
 *       Holidays assigned to the logged-in employee's company.
 *       Permission: Self → Holiday → view.
 *       Inactive holidays are hidden unless `isActive=false`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer, example: 2026 }
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-01-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-12-31" }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Holidays for the employee's company }
 */
router.get(
  "/me",
  protect,
  employeeOnly,
  checkPermission("Self", "Holiday", "view"),
  validateQuery(myHolidayQuerySchema),
  myHolidays
);

router.get("/", ...gate("view"), validateQuery(listHolidayQuerySchema), listHolidays);
router.post("/", ...gate("create"), validate(createHolidaySchema), createHoliday);

/**
 * @swagger
 * /api/holidays/assign:
 *   post:
 *     tags: [Work / Holiday]
 *     summary: Assign holidays to companies
 *     description: |
 *       `mode: add` (default) adds companyIds onto each holiday.
 *       `mode: remove` takes those companies off.
 *       `mode: replace` sets companyIds to exactly this list.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [holidayIds, companyIds]
 *             properties:
 *               holidayIds:
 *                 type: array
 *                 items: { type: string }
 *               companyIds:
 *                 type: array
 *                 items: { type: string }
 *               mode:
 *                 type: string
 *                 enum: [add, remove, replace]
 *                 default: add
 *     responses:
 *       200: { description: Updated holidays }
 *       403: { description: Company is outside the actor's access }
 *       404: { description: Holiday not found }
 */
router.post("/assign", ...gate("edit"), validate(assignHolidaySchema), assignHolidays);

/**
 * @swagger
 * /api/holidays/{id}:
 *   get:
 *     tags: [Work / Holiday]
 *     summary: Get one holiday
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Holiday }
 *       404: { description: Not found }
 *   put:
 *     tags: [Work / Holiday]
 *     summary: Update holiday fields
 *     description: Does not change company assignment. Use POST /api/holidays/assign.
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
 *     tags: [Work / Holiday]
 *     summary: Delete holiday
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
router.get("/:id", ...gate("view"), getHoliday);
router.put("/:id", ...gate("edit"), validate(updateHolidaySchema), updateHoliday);
router.delete("/:id", ...gate("delete"), deleteHoliday);

module.exports = router;
