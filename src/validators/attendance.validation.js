/**
 * Attendance request validation (Joi)
 *
 * Self punch: source = web | mobile | biometric
 * Manual mark (admin): employeeId, punchType, time, reason, remarks
 * Date is always today — not accepted from client
 */
const Joi = require("joi");

const SELF_SOURCES = ["web", "mobile", "biometric"];

const punchSchema = Joi.object({
  source: Joi.string()
    .valid(...SELF_SOURCES)
    .required()
    .messages({
      "any.required": "source is required (web, mobile, or biometric)",
      "any.only": "source must be web, mobile, or biometric",
    }),
}).unknown(false);

const manualMarkSchema = Joi.object({
  employeeId: Joi.string().hex().length(24).required(),
  punchType: Joi.string().valid("in", "out").required(),
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
