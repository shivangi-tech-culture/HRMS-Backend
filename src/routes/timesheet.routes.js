/**
 * TIMESHEET ROUTES → /api/timesheet
 */
const express = require("express");
const {
  getTimesheet,
  listTeamTimesheet,
} = require("../controllers/timesheet.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validateQuery } = require("../middleware/validate");
const { timesheetQuerySchema } = require("../validators/attendance.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Employee / ESS
 *     description: Time Sheet with filters + pagination
 */

/**
 * @swagger
 * /api/timesheet:
 *   get:
 *     tags: [Employee / ESS]
 *     summary: Employee time sheet (summary + day rows)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: string, example: "2026-09" }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 31 }
 *     responses:
 *       200: { description: Timesheet summary + paginated days }
 */
router.get(
  "/",
  protect,
  validateQuery(timesheetQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Daily Attendance", "view")(
        req,
        res,
        next
      );
    }
    return checkPermission("Self", "Time Sheet", "view")(req, res, next);
  },
  getTimesheet
);

/**
 * @swagger
 * /api/timesheet/team:
 *   get:
 *     tags: [Admin / Attendance]
 *     summary: Team timesheet summary (paginated employees)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/team",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Daily Attendance", "view"),
  validateQuery(timesheetQuerySchema),
  listTeamTimesheet
);

module.exports = router;
