/**
 * ATTENDANCE ROUTES → mounted at /api/attendance
 *
 * Self (ESS):
 *   POST /punch-in, /punch-out
 *   GET  /today, /web-punches
 *   Regularize APIs
 *
 * Admin:
 *   POST /manual, /close-absent
 *   GET  / (list)
 */
const express = require("express");
const {
  punchIn, // self punch in
  punchOut, // self punch out
  markManual, // admin set in/out time
  myToday, // today's record + shift
  listAttendance, // list with filters
  listWebPunches, // flattened IN/OUT rows
  closeAbsent, // past incomplete → Absent
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
  punchSchema, // source + lat + long
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
 *     summary: Punch in (self) with lat/long
 *     description: |
 *       Uses Shift Assignment or default 10:00–19:00.
 *       Address from Map API. Early in after punchStart allowed by default.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PunchBody' }
 *     responses:
 *       201: { description: Punched in }
 *       400: { description: Already punched in / window failed }
 */
// Auth + Joi body → punchIn controller
router.post("/punch-in", protect, validate(punchSchema), punchIn);

/**
 * @swagger
 * /api/attendance/punch-out:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch out (self) with lat/long
 *     description: Needs prior punch-in. Late out allowed by default.
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

/** Admin manual In/Out with HH:mm + reason */
router.post(
  "/manual",
  protect,
  authorize(...ALL_ACCESS),
  validate(manualMarkSchema),
  markManual
);

/** Logged-in user's today attendance + resolved shift */
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
    // Admin sees Daily Attendance permission; employee sees My Web Punches
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

/** Employee creates regularization request */
router.post(
  "/regularize",
  protect,
  checkPermission("Self", "Regularize Attendance", "create"),
  validate(createRegularizationSchema),
  createRegularization
);

/** List regularization (self or admin permission) */
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

/** Admin approve / reject */
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

/** Mark past in-without-out as Absent */
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
