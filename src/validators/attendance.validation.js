/**
 * ATTENDANCE VALIDATION (Joi) — punch · manual mark
 */
const Joi = require("joi");

/** Allowed sources for employee self punch-in / punch-out */
const SELF_SOURCES = ["web", "mobile", "biometric"];

/**
 * SELF PUNCH body — punch-in and punch-out
 * Example: { "source": "web" }
 */
const punchSchema = Joi.object({
  /** Where the employee punched from (manual is admin-only via /manual) */
  source: Joi.string()
    .valid(...SELF_SOURCES)
    .required()
    .messages({
      "any.required": "source is required (web, mobile, or biometric)",
      "any.only": "source must be web, mobile, or biometric",
    }),
}).unknown(false);

/**
 * MANUAL MARK body — admin marks attendance when punch was missed
 * Example:
 *   { "employeeId": "66f0…", "punchType": "in", "time": "09:30", "reason": "Forgot to punch" }
 * Source is forced to "manual" in the controller.
 */
const manualMarkSchema = Joi.object({
  /** MongoDB ObjectId of the employee user */
  employeeId: Joi.string().hex().length(24).required(),
  /** "in" = punch in, "out" = punch out */
  punchType: Joi.string().valid("in", "out").required(),
  /** 24-hour clock HH:mm, e.g. 09:30 */
  time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({ "string.pattern.base": "time must be HH:mm (24h), e.g. 09:30" }),
  reason: Joi.string().trim().min(2).max(200).required(),
  remarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

module.exports = {
  punchSchema,
  manualMarkSchema,
  SELF_SOURCES,
};
