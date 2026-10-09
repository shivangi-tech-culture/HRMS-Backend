/**
 * ATTENDANCE APIs → /api/attendance
 *
 * SAFE: writes Attendance and regularization requests only. Does NOT change company / employee assign.
 *
 * ─── EMPLOYEE (self) ─────────────────────────────────────────
 * POST   /punch-in              { source, latitude, longitude, remarks? }
 * POST   /punch-out             { source, latitude, longitude, remarks? }
 * GET    /today
 * GET    /web-punches           ?date=&from=&to=&page=&limit=
 *
 * ─── ADMIN / HR / MANAGER ────────────────────────────────────
 * GET    /daily                 ?date=YYYY-MM-DD (default today) &companyId=
 * GET    /calendar              ?month=YYYY-MM&date=YYYY-MM-DD  (month counts + that day's rows)
 * GET    /late-early            ?type=late|early&date=
 * GET    /late-early/:id        one record (same late/early numbers as the list)
 * POST   /mark                  { employeeId, date, punchInTime?, punchOutTime?, reason, remarks? }
 *                        Missed punch only. Does not change employee assignment.
 * POST   /:id/review?decision=approve|reject   body: { reason }
 *                        One API. Late only. Day stays Present.
 *
 * ─── EMPLOYEE TIMESHEET + REGULARIZATION ─────────────────────
 * GET    /timesheet            ?month=YYYY-MM | from=&to=  optional employeeId
 * POST   /regularize           self only. Same body as mark, without employeeId.
 * GET    /regularize           own requests
 * POST   /regularize/:id/cancel
 * GET    /regularizations      HR / manager / admin / super admin queue
 * POST   /regularizations/:id/review?decision=approve|reject
 *
 * Approve writes the punches and the day becomes Present.
 * Pending stays pending. Reject stays Absent.
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
  markAttendance,
  reviewRemark,
} = require("../controllers/attendance.controller");
const {
  myTimesheet,
  requestRegularization,
  myRegularizations,
  cancelRegularization,
  listRegularizations,
  reviewRegularization,
} = require("../controllers/regularization.controller");
const {
  listLateEarly,
  getLateEarlyDetail,
} = require("../controllers/lateEarly.controller");
const { protect, hasAllAccess } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { hasGlobalCompanyAccess } = require("../utils/companyScope");
const { normalizeRoleName, ALL_ACCESS, EMPLOYEE } = require("../config/roles");
const { validate, validateQuery } = require("../middleware/validate");
const {
  punchSchema,
  webPunchQuerySchema,
  dailyQuerySchema,
  calendarQuerySchema,
  remarkReviewSchema,
  markAttendanceSchema,
  lateEarlyQuerySchema,
  timesheetQuerySchema,
  regularizeSchema,
  myRegularizeQuerySchema,
  regularizationListQuerySchema,
} = require("../validators/attendance.validation");

const router = express.Router();

/** Admin-side permission helper (Super Admin/Admin skip matrix) */
const needAttendance = (subModule, action = "view") => (req, res, next) => {
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  return checkPermission("Attendance", subModule, action)(req, res, next);
};

/** Employee ESS permission, or the admin Attendance Regularization action. */
const needSelfRegularize = (essAction, adminAction) => (req, res, next) => {
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  if (normalizeRoleName(req.user?.role) === EMPLOYEE) {
    return checkPermission("Self", "Regularize Attendance", essAction)(req, res, next);
  }
  return checkPermission("Attendance", "Attendance Regularization", adminAction)(req, res, next);
};

const needTimesheet = (req, res, next) => {
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  const other =
    req.query.employeeId && String(req.query.employeeId) !== String(req.user._id);
  if (normalizeRoleName(req.user?.role) === EMPLOYEE || !other) {
    if (normalizeRoleName(req.user?.role) === EMPLOYEE) {
      return checkPermission("Self", "Time Sheet", "view")(req, res, next);
    }
    return next();
  }
  return needAttendance("Daily Attendance", "view")(req, res, next);
};

/** Approve or reject a regularization. Employee cannot. */
const needRegularizationReview = (req, res, next) => {
  const role = normalizeRoleName(req.user?.role);
  if (role === EMPLOYEE) {
    return res.status(403).json({ message: "Employees cannot approve or reject regularization" });
  }
  if (ALL_ACCESS.includes(role) || hasGlobalCompanyAccess(req.user)) return next();
  const action = String(req.body.decision || "").toLowerCase() === "reject" ? "reject" : "approve";
  return checkPermission("Attendance", "Attendance Regularization", action)(req, res, next);
};

/** Approve or reject a late punch. Body.decision picks the permission. */
const needRemarkReview = (req, res, next) => {
  const role = normalizeRoleName(req.user?.role);
  if (ALL_ACCESS.includes(role) || hasGlobalCompanyAccess(req.user)) return next();
  const action = String(req.body.decision || "").toLowerCase() === "reject" ? "reject" : "approve";
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
  "/late-early/:id",
  protect,
  needAttendance("Late & Early Departures", "view"),
  getLateEarlyDetail
);

/** Copy ?decision=approve|reject onto the body so one route serves both Postman calls. */
const attachReviewDecision = (req, _res, next) => {
  const fromQuery = String(req.query.decision || "").trim().toLowerCase();
  if (fromQuery && !req.body?.decision) {
    req.body = { ...(req.body || {}), decision: fromQuery };
  }
  next();
};

router.post(
  "/mark",
  protect,
  validate(markAttendanceSchema),
  needAttendance("Daily Attendance", "create"),
  markAttendance
);

// ─── Employee timesheet + regularization ─────────────────────

router.get("/timesheet", protect, validateQuery(timesheetQuerySchema), needTimesheet, myTimesheet);

router.post(
  "/regularize",
  protect,
  validate(regularizeSchema),
  needSelfRegularize("create", "create"),
  requestRegularization
);

router.get(
  "/regularize",
  protect,
  validateQuery(myRegularizeQuerySchema),
  needSelfRegularize("view", "view"),
  myRegularizations
);

router.post(
  "/regularize/:id/cancel",
  protect,
  needSelfRegularize("cancel", "cancel"),
  cancelRegularization
);

router.get(
  "/regularizations",
  protect,
  validateQuery(regularizationListQuerySchema),
  needAttendance("Attendance Regularization", "view"),
  listRegularizations
);

router.post(
  "/regularizations/:id/review",
  protect,
  attachReviewDecision,
  validate(remarkReviewSchema),
  needRegularizationReview,
  reviewRegularization
);

/** POST /api/attendance/:id/review?decision=approve|reject — body: { reason } */
router.post(
  "/:id/review",
  protect,
  attachReviewDecision,
  validate(remarkReviewSchema),
  needRemarkReview,
  reviewRemark
);

module.exports = router;
