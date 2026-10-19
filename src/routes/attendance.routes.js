/**
 * ATTENDANCE APIs → /api/attendance
 *
 * SAFE: writes Attendance and regularization requests only. Does NOT change company / employee assign.
 *
 * ─── EMPLOYEE (self) ─────────────────────────────────────────
 * POST   /punch-in              { source, latitude, longitude, remarks? }
 * POST   /punch-out             { source, latitude, longitude, remarks? }
 * GET    /today
 * GET    /punch-status          ?date=   employee + company from login token
 * GET    /web-punches           ?date=&from=&to=&page=&limit=
 *
 * ─── ADMIN / HR / MANAGER ────────────────────────────────────
 * GET    /daily                 ?date=YYYY-MM-DD (default today) &companyId=
 * GET    /calendar              ?month=YYYY-MM&date=YYYY-MM-DD  (month counts + that day's rows)
 * GET    /late-early            ?type=late|early&date=
 * GET    /late-early/:id        one record (same late/early numbers as the list)
 *
 * ─── EMPLOYEE TIMESHEET + REGULARIZATION ─────────────────────
 * GET    /timesheet            ?month=YYYY-MM | from=&to=  optional employeeId
 * POST   /regularize           self only. Missed punch times, or a Late day reason. document is optional (upload type regularization).
 * GET    /regularize           own requests
 * POST   /regularize/:id/cancel
 * GET    /regularizations      HR / manager / admin / super admin queue
 * POST   /regularizations/:id/review?decision=approve|reject
 *
 * ─── ON TOUR / ON DUTY ───────────────────────────────────────
 * POST   /tour-duty            employee. { dutyType, tourCategory, fromDate, fromTime, toDate, toTime, reason, remarks?, document? }
 * GET    /tour-duty            own list. status, month=YYYY-MM
 * GET    /tour-duty/:id
 * POST   /tour-duty/:id/cancel pending only
 * GET    /tour-duties          Attendance → On Tour/On Duty queue
 * POST   /tour-duties/:id/review?decision=approve|reject
 *
 * Approve sets each covered day to Present.
 * Reject sets each covered day to Absent.
 * Reviewer: Reporting Manager (own team), HR (assigned companies), or Super Admin.
 * Approve writes the punches and the day becomes Present.
 * Pending stays pending. Reject stays Absent.
 * Scope: SA/Admin = all · HR = assigned companies · Manager = team
 */
const express = require("express");
const {
  punchIn,
  punchOut,
  myToday,
  getPunchStatus,
  listWebPunches,
  listDailyAttendance,
  attendanceCalendar,
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
  requestTourDuty,
  myTourDuty,
  getTourDuty,
  cancelTourDuty,
  listTourDuty,
  reviewTourDuty,
} = require("../controllers/tourDuty.controller");
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
  punchStatusQuerySchema,
  webPunchQuerySchema,
  dailyQuerySchema,
  calendarQuerySchema,
  remarkReviewSchema,
  lateEarlyQuerySchema,
  timesheetQuerySchema,
  regularizeSchema,
  myRegularizeQuerySchema,
  regularizationListQuerySchema,
  tourDutySchema,
  myTourDutyQuerySchema,
  tourDutyListQuerySchema,
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

/** Employee applies and cancels. Admin reviews under Attendance → On Tour/On Duty. */
const needSelfTourDuty = (action) => (req, res, next) => {
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  if (normalizeRoleName(req.user?.role) === EMPLOYEE) {
    return checkPermission("Self", "On Tour/On Duty Entries", action)(req, res, next);
  }
  return checkPermission("Attendance", "On Tour/On Duty", action === "create" ? "view" : action)(req, res, next);
};

const needTourDutyReview = (req, res, next) => {
  const role = normalizeRoleName(req.user?.role);
  if (role === EMPLOYEE) {
    return res.status(403).json({ message: "Employees cannot approve or reject On Tour / On Duty" });
  }
  if (ALL_ACCESS.includes(role) || hasGlobalCompanyAccess(req.user)) return next();
  const action = String(req.body.decision || "").toLowerCase() === "reject" ? "reject" : "approve";
  return checkPermission("Attendance", "On Tour/On Duty", action)(req, res, next);
};

// ─── Employee self punch ─────────────────────────────────────

router.post("/punch-in", protect, validate(punchSchema), punchIn);
router.post("/punch-out", protect, validate(punchSchema), punchOut);
router.get("/today", protect, myToday);

router.get("/punch-status", protect, validateQuery(punchStatusQuerySchema), getPunchStatus);

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

router.post(
  "/tour-duty",
  protect,
  validate(tourDutySchema),
  needSelfTourDuty("create"),
  requestTourDuty
);

router.get(
  "/tour-duty",
  protect,
  validateQuery(myTourDutyQuerySchema),
  needSelfTourDuty("view"),
  myTourDuty
);

router.get("/tour-duty/:id", protect, needSelfTourDuty("view"), getTourDuty);

router.post(
  "/tour-duty/:id/cancel",
  protect,
  needSelfTourDuty("cancel"),
  cancelTourDuty
);

router.get(
  "/tour-duties",
  protect,
  validateQuery(tourDutyListQuerySchema),
  needAttendance("On Tour/On Duty", "view"),
  listTourDuty
);

router.post(
  "/tour-duties/:id/review",
  protect,
  attachReviewDecision,
  validate(remarkReviewSchema),
  needTourDutyReview,
  reviewTourDuty
);

module.exports = router;
