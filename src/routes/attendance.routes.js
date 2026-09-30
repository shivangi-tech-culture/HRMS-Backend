/**
 * ATTENDANCE ROUTES → mounted at /api/attendance
 *
 * Admin UI (https://hrms-techculture.vercel.app/attendance):
 *   Daily Attendance, Calendar, Regularize, Late/Early, Overtime
 *
 * ESS:
 *   punch-in/out, today, web-punches, regularize (self)
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
  getAttendanceDetails,
  getAttendanceCalendar,
  listLateEarly,
  getAttendanceHistory,
  getManualMarkMeta,
} = require("../controllers/attendance.controller");
const {
  getRegularizationMeta,
  createRegularization,
  listRegularizations,
  getRegularization,
  cancelRegularization,
  reviewRegularization,
} = require("../controllers/regularization.controller");
const {
  listOvertime,
  createOvertime,
  reviewOvertime,
  getOvertime,
} = require("../controllers/overtime.controller");
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
  calendarQuerySchema,
  detailsQuerySchema,
  lateEarlyQuerySchema,
  overtimeQuerySchema,
  createOvertimeSchema,
  reviewOvertimeSchema,
  historyQuerySchema,
} = require("../validators/attendance.validation");

const router = express.Router();

// ── Self punch ───────────────────────────────────────────────────────────────
router.post("/punch-in", protect, validate(punchSchema), punchIn);
router.post("/punch-out", protect, validate(punchSchema), punchOut);

router.post(
  "/manual",
  protect,
  authorize(...ALL_ACCESS),
  validate(manualMarkSchema),
  markManual
);

/** Mark Attendance modal — reason dropdown from masters */
router.get(
  "/manual/meta",
  protect,
  authorize(...ALL_ACCESS),
  getManualMarkMeta
);

router.get("/today", protect, myToday);

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

// ── Daily details + history (side panel) ─────────────────────────────────────
router.get(
  "/details/:id",
  protect,
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Daily Attendance", "view")(
        req,
        res,
        next
      );
    }
    return next();
  },
  getAttendanceDetails
);

router.get(
  "/details",
  protect,
  validateQuery(detailsQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Daily Attendance", "view")(
        req,
        res,
        next
      );
    }
    return next();
  },
  getAttendanceDetails
);

router.get(
  "/history",
  protect,
  validateQuery(historyQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Daily Attendance", "view")(
        req,
        res,
        next
      );
    }
    return next();
  },
  getAttendanceHistory
);

// ── Attendance Calendar ──────────────────────────────────────────────────────
router.get(
  "/calendar",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Attendance Calendar", "view"),
  validateQuery(calendarQuerySchema),
  getAttendanceCalendar
);

// ── Late & Early ─────────────────────────────────────────────────────────────
router.get(
  "/late-early",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Late & Early Departures", "view"),
  validateQuery(lateEarlyQuerySchema),
  listLateEarly
);

// ── Overtime ─────────────────────────────────────────────────────────────────
router.get(
  "/overtime",
  protect,
  validateQuery(overtimeQuerySchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Overtime", "view")(req, res, next);
    }
    return next();
  },
  listOvertime
);

router.post(
  "/overtime",
  protect,
  validate(createOvertimeSchema),
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission("Attendance", "Overtime", "create")(
        req,
        res,
        next
      );
    }
    return next();
  },
  createOvertime
);

router.get("/overtime/:id", protect, getOvertime);

router.post(
  "/overtime/:id/review",
  protect,
  authorize(...ALL_ACCESS),
  (req, res, next) => {
    const action =
      req.body?.status === "Rejected" ? "reject" : "approve";
    return checkPermission("Attendance", "Overtime", action)(req, res, next);
  },
  validate(reviewOvertimeSchema),
  reviewOvertime
);

// ── Regularization (Daily Attendance modal + Regularization screen) ──────────
/** Dropdown meta — MUST be before /regularize/:id */
router.get("/regularize/meta", protect, getRegularizationMeta);

router.post(
  "/regularize",
  protect,
  (req, res, next) => {
    // Admin from Daily Attendance OR ESS self request
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission(
        "Attendance",
        "Attendance Regularization",
        "create"
      )(req, res, next);
    }
    return checkPermission("Self", "Regularize Attendance", "create")(
      req,
      res,
      next
    );
  },
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
  (req, res, next) => {
    if (ALL_ACCESS.includes(req.user?.role)) {
      return checkPermission(
        "Attendance",
        "Attendance Regularization",
        "cancel"
      )(req, res, next);
    }
    return checkPermission("Self", "Regularize Attendance", "cancel")(
      req,
      res,
      next
    );
  },
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

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Daily Attendance", "view"),
  validateQuery(listAttendanceQuerySchema),
  listAttendance
);

module.exports = router;
