/**
 * ATTENDANCE APIs → /api/attendance
 *
 * SAFE: only Attendance collection. Does NOT change company / employee assign.
 *
 * ─── EMPLOYEE (self) ─────────────────────────────────────────
 * POST   /punch-in              { source, latitude, longitude, remarks? }
 * POST   /punch-out             { source, latitude, longitude, remarks? }
 * GET    /today
 * GET    /web-punches           ?date=&from=&to=&page=&limit=
 *
 * ─── ADMIN / HR / MANAGER ────────────────────────────────────
 * GET    /daily                 today only — ?search=&department=&branchId=&shiftId=&…
 * GET    /calendar              ?month=YYYY-MM&date=YYYY-MM-DD  (month counts + that day's rows)
 * GET    /late-early            ?type=late|early&date=
 * GET    /late-early/:id        detail drawer
 * GET    /late-early/:id/history
 * POST   /:id/review-remark     { decision: "approve"|"reject" } → Present / Absent
 * POST   /:id/approve | /:id/reject   shortcuts (same update)
 *
 * Scope: SA/Admin = all · HR = assigned companies · Manager = team
 */
const express = require("express");
const {
  punchIn,
  punchOut,
  myToday,
  listWebPunches,
  listDailyAttendance,
  attendanceCalendar,
  reviewRemark,
  approveRemark,
  rejectRemark,
} = require("../controllers/attendance.controller");
const {
  listLateEarly,
  getLateEarlyDetail,
  getLateEarlyHistory,
} = require("../controllers/lateEarly.controller");
const { protect, hasAllAccess } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { hasGlobalCompanyAccess } = require("../utils/companyScope");
const { validate, validateQuery } = require("../middleware/validate");
const {
  punchSchema,
  webPunchQuerySchema,
  dailyQuerySchema,
  calendarQuerySchema,
  remarkReviewSchema,
  lateEarlyQuerySchema,
  lateEarlyHistoryQuerySchema,
} = require("../validators/attendance.validation");

const router = express.Router();

/** Admin-side permission helper (Super Admin/Admin skip matrix) */
const needAttendance = (subModule, action = "view") => (req, res, next) => {
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  return checkPermission("Attendance", subModule, action)(req, res, next);
};

/** Approve/reject guard — Super Admin/Admin always; others need matrix flag */
const needRemarkReview = (action) => (req, res, next) => {
  if (hasGlobalCompanyAccess(req.user)) return next();
  return checkPermission("Attendance", "Daily Attendance", action)(req, res, next);
};

// ─── Employee self punch ─────────────────────────────────────

router.post("/punch-in", protect, validate(punchSchema), punchIn);
router.post("/punch-out", protect, validate(punchSchema), punchOut);
router.get("/today", protect, myToday);

router.get(
  "/web-punches",
  protect,
  validateQuery(webPunchQuerySchema),
  (req, res, next) =>
    hasAllAccess(req.user)
      ? next()
      : checkPermission("Self", "My Web Punches", "view")(req, res, next),
  listWebPunches
);

// ─── Daily attendance (date-wise table) ──────────────────────

router.get(
  "/daily",
  protect,
  validateQuery(dailyQuerySchema),
  needAttendance("Daily Attendance", "view"),
  listDailyAttendance
);

// ─── Calendar (all days in month) ────────────────────────────

router.get(
  "/calendar",
  protect,
  validateQuery(calendarQuerySchema),
  needAttendance("Attendance Calendar", "view"),
  attendanceCalendar
);

// ─── Late & Early Departures ─────────────────────────────────

router.get(
  "/late-early",
  protect,
  validateQuery(lateEarlyQuerySchema),
  needAttendance("Late & Early Departures", "view"),
  listLateEarly
);

router.get(
  "/late-early/:id/history",
  protect,
  validateQuery(lateEarlyHistoryQuerySchema),
  needAttendance("Late & Early Departures", "view"),
  getLateEarlyHistory
);

router.get(
  "/late-early/:id",
  protect,
  needAttendance("Late & Early Departures", "view"),
  getLateEarlyDetail
);

// ─── Remark approve / reject (simple) ────────────────────────

/** Easy: POST /api/attendance/:id/approve — no body */
router.post(
  "/:id/approve",
  protect,
  needRemarkReview("approve"),
  approveRemark
);

/** Easy: POST /api/attendance/:id/reject — no body */
router.post(
  "/:id/reject",
  protect,
  needRemarkReview("reject"),
  rejectRemark
);

/** Also: POST /api/attendance/:id/review-remark { decision } */
router.post(
  "/:id/review-remark",
  protect,
  validate(remarkReviewSchema),
  (req, res, next) => {
    const decision = String(req.body.decision || "").toLowerCase();
    const action = decision === "reject" ? "reject" : "approve";
    return needRemarkReview(action)(req, res, next);
  },
  reviewRemark
);

module.exports = router;
