/**
 * ATTENDANCE VALIDATION (Joi) — punch · manual · list · timesheet · regularize
 */
const Joi = require("joi");

/** Allowed sources for employee self punch-in / punch-out */
const SELF_SOURCES = ["web", "mobile", "biometric"];

const dateStr = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });

const timeHm = Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
  .messages({ "string.pattern.base": "time must be HH:mm (24h), e.g. 09:30" });

/**
 * SELF PUNCH body — punch-in and punch-out
 * Only lat + long from client. Address is always fetched via Map API and saved in DB.
 */
const punchSchema = Joi.object({
  source: Joi.string()
    .valid(...SELF_SOURCES)
    .required()
    .messages({
      "any.required": "source is required (web, mobile, or biometric)",
      "any.only": "source must be web, mobile, or biometric",
    }),
  latitude: Joi.number().min(-90).max(90).required().messages({
    "any.required": "latitude is required",
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    "any.required": "longitude is required",
  }),
  remarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const manualMarkSchema = Joi.object({
  employeeId: Joi.string().hex().length(24).required(),
  punchType: Joi.string().valid("in", "out").required(),
  time: timeHm.required(),
  /** From Master type=markAttendanceReason */
  reason: Joi.string().trim().min(2).max(200).required(),
  /** Optional — defaults to today */
  date: dateStr.optional(),
  remarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const listAttendanceQuerySchema = Joi.object({
  /** Single day (Daily Attendance UI date picker) YYYY-MM-DD */
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  /** Search name or employee code */
  search: Joi.string().trim().allow("").max(100).optional(),
  /** official.department name */
  department: Joi.string().trim().allow("").max(100).optional(),
  /** Match punch address text (office / geo label) */
  location: Joi.string().trim().allow("").max(200).optional(),
  /** Shift master id */
  shiftId: Joi.string().hex().length(24).allow("", null).optional(),
  /**
   * Punch mode / verification:
   * web | mobile | biometric | manual
   * aliases: face→biometric, location→web
   */
  mode: Joi.string().trim().allow("").max(40).optional(),
  source: Joi.string()
    .valid("web", "mobile", "biometric", "manual")
    .optional(),
  /**
   * Status tab / dropdown:
   * ALL | Present | Absent | Late | Working | HalfDay | WeeklyOff | Holiday | Pending | OnLeave | WFH
   */
  status: Joi.string()
    .valid(
      "Pending",
      "Present",
      "Absent",
      "HalfDay",
      "WeeklyOff",
      "Holiday",
      "MissedPunch",
      "Working",
      "Late",
      "OnLeave",
      "WFH",
      "ALL"
    )
    .optional(),
  employeeId: Joi.string().hex().length(24).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

const timesheetQuerySchema = Joi.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .optional()
    .messages({ "string.pattern.base": "month must be YYYY-MM" }),
  year: Joi.string().trim().allow("").optional(),
  employeeId: Joi.string().hex().length(24).optional(),
  status: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(31),
}).unknown(true);

const createRegularizationSchema = Joi.object({
  /** Preferred: sheetDate — UI also sends date */
  sheetDate: dateStr.optional(),
  date: dateStr.optional(),
  /** Admin Daily Attendance modal: pick employee */
  employeeId: Joi.string().hex().length(24).optional(),
  employee: Joi.string().hex().length(24).optional(),
  /** HH:mm — aliases accepted for UI field names */
  requestedInTime: timeHm.allow(null, "").optional(),
  requestedOutTime: timeHm.allow(null, "").optional(),
  requestedPunchIn: timeHm.allow(null, "").optional(),
  requestedPunchOut: timeHm.allow(null, "").optional(),
  punchIn: timeHm.allow(null, "").optional(),
  punchOut: timeHm.allow(null, "").optional(),
  /** Correction Type: Late Mark | Missed Punch In | … */
  type: Joi.string().trim().allow("").max(60).optional(),
  /** Reason dropdown — required by UI */
  reason: Joi.string().trim().min(2).max(200).required(),
  remarks: Joi.string().trim().allow("").max(500).optional(),
})
  .or("sheetDate", "date")
  .or(
    "requestedInTime",
    "requestedOutTime",
    "requestedPunchIn",
    "requestedPunchOut",
    "punchIn",
    "punchOut"
  )
  .unknown(false);

const historyQuerySchema = Joi.object({
  employeeId: Joi.string().hex().length(24).optional(),
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
}).unknown(true);

const reviewRegularizationSchema = Joi.object({
  status: Joi.string().valid("Approved", "Rejected").required(),
  reviewRemarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const listRegularizationQuerySchema = Joi.object({
  status: Joi.string()
    .valid("Pending", "Approved", "Rejected", "Cancelled", "ALL")
    .default("ALL"),
  /** Filter by request type (UI "All types") */
  type: Joi.string().trim().allow("").max(60).optional(),
  /** Search employee name or code */
  search: Joi.string().trim().allow("").max(100).optional(),
  year: Joi.string().trim().allow("").optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  employeeId: Joi.string().hex().length(24).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const calendarQuerySchema = Joi.object({
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .optional()
    .messages({ "string.pattern.base": "month must be YYYY-MM" }),
  date: dateStr.optional(),
  search: Joi.string().trim().allow("").max(100).optional(),
  department: Joi.string().trim().allow("").max(100).optional(),
  status: Joi.string().trim().allow("").optional(),
  employeeId: Joi.string().hex().length(24).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

const detailsQuerySchema = Joi.object({
  employeeId: Joi.string().hex().length(24).optional(),
  date: dateStr.optional(),
}).unknown(true);

const lateEarlyQuerySchema = Joi.object({
  /** late | early | all */
  type: Joi.string()
    .valid("late", "early", "all", "Late", "Early", "ALL")
    .default("late"),
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  search: Joi.string().trim().allow("").max(100).optional(),
  department: Joi.string().trim().allow("").max(100).optional(),
  shiftId: Joi.string().hex().length(24).allow("", null).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(10),
}).unknown(true);

const overtimeQuerySchema = Joi.object({
  status: Joi.string()
    .valid(
      "Pending",
      "Approved",
      "Rejected",
      "Comp Off Credited",
      "ALL"
    )
    .optional(),
  type: Joi.string().trim().allow("").max(40).optional(),
  search: Joi.string().trim().allow("").max(100).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .optional(),
  employeeId: Joi.string().hex().length(24).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const createOvertimeSchema = Joi.object({
  date: dateStr.required(),
  type: Joi.string()
    .valid("Overtime Pay", "Comp Off")
    .default("Overtime Pay"),
  reason: Joi.string().trim().min(2).max(500).required(),
  otHours: Joi.alternatives()
    .try(Joi.string().trim().allow(""), Joi.number())
    .optional(),
  otMinutes: Joi.number().integer().min(0).optional(),
  employeeId: Joi.string().hex().length(24).optional(),
}).unknown(false);

const reviewOvertimeSchema = Joi.object({
  status: Joi.string().valid("Approved", "Rejected").required(),
  reviewRemarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

module.exports = {
  punchSchema,
  manualMarkSchema,
  listAttendanceQuerySchema,
  timesheetQuerySchema,
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
  SELF_SOURCES,
};
