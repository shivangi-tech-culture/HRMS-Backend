/**
 * ATTENDANCE VALIDATION (Joi) — self punch · own punch list
 */
const Joi = require("joi");
const { DAY_STATUSES } = require("../models/Attendance");

/** Allowed sources for employee self punch-in / punch-out */
const SELF_SOURCES = ["web", "mobile", "biometric"];

const dateStr = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });

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

module.exports = { punchSchema, webPunchQuerySchema, SELF_SOURCES };
