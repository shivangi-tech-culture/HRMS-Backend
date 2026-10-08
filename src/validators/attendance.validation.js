/**
 * ATTENDANCE VALIDATION (Joi)
 * punch · web-punches · daily · calendar · remark review
 * Validates request shape only — no company/employee assign side effects.
 */
const Joi = require("joi");
const { DAY_STATUSES, ATTENDANCE_STATUSES } = require("../models/Attendance");

const SELF_SOURCES = ["web", "mobile", "biometric"];

const dateStr = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });

const objectId = Joi.string().hex().length(24);

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

/** GET /api/attendance/web-punches — own punches */
const webPunchQuerySchema = Joi.object({
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: Joi.string().valid(...DAY_STATUSES, "ALL").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(false);

/** GET /api/attendance/daily — always today. No date param. */
const dailyQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(100).optional(),
  department: Joi.string().trim().allow("", "ALL").optional(),
  branchId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  shiftId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  companyId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  workMode: Joi.string().valid("WFO", "WFH", "Hybrid", "ALL").optional(),
  status: Joi.string()
    .valid(...DAY_STATUSES, "ALL")
    .optional(),
  attendanceStatus: Joi.string().valid(...ATTENDANCE_STATUSES, "ALL").optional(),
  hasRemark: Joi.string().valid("true", "false", "1", "0", "").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(false);

/** GET /api/attendance/calendar — month grid + one day's rows */
const calendarQuerySchema = Joi.object({
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .optional(),
  date: dateStr.optional(),
  search: Joi.string().trim().allow("").max(100).optional(),
  companyId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  department: Joi.string().trim().allow("", "ALL").optional(),
  branchId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  shiftId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  workMode: Joi.string().valid("WFO", "WFH", "Hybrid", "ALL").optional(),
  status: Joi.string().valid(...DAY_STATUSES, "ALL").optional(),
  attendanceStatus: Joi.string().valid(...ATTENDANCE_STATUSES, "ALL").optional(),
  hasRemark: Joi.string().valid("true", "false", "1", "0", "").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(false);

/** Reason HR / manager writes when approving or rejecting a late punch */
const reviewReason = Joi.string().trim().min(1).max(500).required().messages({
  "any.required": "reason is required",
  "string.empty": "reason is required",
  "string.min": "reason is required",
});

/** POST /api/attendance/mark — missed punch in, punch out, or both */
const markAttendanceSchema = Joi.object({
  employeeId: objectId.required().messages({
    "any.required": "employeeId is required",
  }),
  date: dateStr.required().messages({
    "any.required": "date is required",
  }),
  punchInTime: Joi.string().trim().allow("").optional(),
  punchOutTime: Joi.string().trim().allow("").optional(),
  reason: Joi.string().trim().min(1).max(200).required().messages({
    "any.required": "reason is required",
    "string.empty": "reason is required",
  }),
  remarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);
const remarkReviewSchema = Joi.object({
  decision: Joi.string().valid("approve", "reject").required().messages({
    "any.only": 'decision must be "approve" or "reject"',
    "any.required": "decision is required",
  }),
  reason: reviewReason,
}).unknown(false);

/**
 * GET /api/attendance/late-early
 * type=late → late arrival (after shift start + grace)
 * type=early → early arrival (before shift start)
 * type=all → both
 */
const lateEarlyQuerySchema = Joi.object({
  type: Joi.string().valid("late", "early", "all").default("all"),
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  search: Joi.string().trim().allow("").max(100).optional(),
  department: Joi.string().trim().allow("", "ALL").optional(),
  branchId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  shiftId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  companyId: Joi.alternatives().try(objectId, Joi.string().valid("ALL")).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(10),
}).unknown(false);

module.exports = {
  punchSchema,
  webPunchQuerySchema,
  dailyQuerySchema,
  calendarQuerySchema,
  remarkReviewSchema,
  markAttendanceSchema,
  lateEarlyQuerySchema,
  SELF_SOURCES,
};
