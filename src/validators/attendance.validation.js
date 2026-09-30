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
  reason: Joi.string().trim().min(2).max(200).required(),
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
  sheetDate: dateStr.required(),
  requestedInTime: timeHm.allow(null, "").optional(),
  requestedOutTime: timeHm.allow(null, "").optional(),
  /** UI type: Missed Punch Out | Late Mark | Missed Punch In | Early Exit | Wrong Status */
  type: Joi.string().trim().allow("").max(60).optional(),
  remarks: Joi.string().trim().min(2).max(500).required(),
})
  .or("requestedInTime", "requestedOutTime")
  .unknown(false);

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

module.exports = {
  punchSchema,
  manualMarkSchema,
  listAttendanceQuerySchema,
  timesheetQuerySchema,
  createRegularizationSchema,
  reviewRegularizationSchema,
  listRegularizationQuerySchema,
  SELF_SOURCES,
};
