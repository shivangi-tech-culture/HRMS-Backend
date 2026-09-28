/**
 * ATTENDANCE ROUTES → /api/attendance
 * Punch in/out (geo), manual, today, list, web punches, regularize, close-absent
 */
const express = require("express");
const {
  punchIn,
  punchOut,
  markManual,
  myToday,
  listAttendance,
  listWebPunches,
  closeAbsent,
} = require("../controllers/attendance.controller");
const {
  createRegularization,
  listRegularizations,
  getRegularization,
  cancelRegularization,
  reviewRegularization,
} = require("../controllers/regularization.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  punchSchema,
  manualMarkSchema,
  listAttendanceQuerySchema,
  createRegularizationSchema,
  reviewRegularizationSchema,
  listRegularizationQuerySchema,
} = require("../validators/attendance.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Attendance
 *     description: Manual mark, list, regularize review, close absent
 *   - name: Employee / ESS
 *     description: Punch in/out + web punches + regularize
 */

/**
 * @swagger
 * /api/attendance/punch-in:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch in (self) with lat/long/address
 *     description: |
 *       Saves geolocation. If address omitted, reverse-geocodes via Map API.
 *       Attaches employee's assigned shift. Early punch-in before shift start is accepted.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PunchBody' }
 *     responses:
 *       201: { description: Punched in }
 *       400: { description: Already punched in / validation failed }
 */
router.post("/punch-in", protect, validate(punchSchema), punchIn);

/**
 * @swagger
 * /api/attendance/punch-out:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch out (self) with lat/long/address
 *     description: Late punch-out after shift end is accepted. Missing punch-out → Absent on timesheet.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PunchBody' }
 *     responses:
 *       200: { description: Punched out }
 */
router.post("/punch-out", protect, validate(punchSchema), punchOut);

router.post(
  "/manual",
  protect,
  authorize(...ALL_ACCESS),
  validate(manualMarkSchema),
  markManual
);

router.get("/today", protect, myToday);

/**
 * @swagger
 * /api/attendance/web-punches:
 *   get:
 *     tags: [Employee / ESS]
 *     summary: My Web Punches (IN/OUT rows with geo)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/web-punches",
  protect,
  validateQuery(listAttendanceQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Daily Attendance", "view")(
        req,
        res,
        next
      );
    }
    return checkPermission("Self", "My Web Punches", "view")(req, res, next);
  },
  listWebPunches
);

/**
 * Regularize Attendance
 */
router.post(
  "/regularize",
  protect,
  checkPermission("Self", "Regularize Attendance", "create"),
  validate(createRegularizationSchema),
  createRegularization
);

router.get(
  "/regularize",
  protect,
  validateQuery(listRegularizationQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Attendance Regularization", "view")(
        req,
        res,
        next
      );
    }
    return checkPermission("Self", "Regularize Attendance", "view")(
      req,
      res,
      next
    );
  },
  listRegularizations
);

router.get("/regularize/:id", protect, getRegularization);

router.post(
  "/regularize/:id/cancel",
  protect,
  checkPermission("Self", "Regularize Attendance", "cancel"),
  cancelRegularization
);

router.post(
  "/regularize/:id/review",
  protect,
  authorize(...ALL_ACCESS),
  (req, res, next) => {
    const action =
      req.body?.status === "Rejected" ? "reject" : "approve";
    return checkPermission(
      "Attendance",
      "Attendance Regularization",
      action
    )(req, res, next);
  },
  validate(reviewRegularizationSchema),
  reviewRegularization
);

router.post(
  "/close-absent",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Daily Attendance", "edit"),
  closeAbsent
);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     tags: [Admin / Attendance]
 *     summary: List attendance (filters + pagination)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/",
  protect,
  validateQuery(listAttendanceQuerySchema),
  listAttendance
);

module.exports = router;
