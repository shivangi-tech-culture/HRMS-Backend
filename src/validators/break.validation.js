/**
 * BREAK VALIDATION — start, lists, and policy CRUD.
 */
const Joi = require("joi");

const dateStr = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });

/** Blank, ALL, or a Mongo id */
const optionalId = Joi.string()
  .trim()
  .allow("", "ALL")
  .optional()
  .custom((value, helpers) => {
    if (!value || String(value).toUpperCase() === "ALL") return value;
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.message("must be a valid id");
    }
    return value;
  });

const startSchema = Joi.object({
  breakType: Joi.string().trim().min(1).max(60).required().messages({
    "any.required": "breakType is required",
  }),
  minutes: Joi.number().integer().min(1).max(180).optional(),
}).unknown(false);

const policySchema = Joi.object({
  name: Joi.string().trim().min(1).max(60).required(),
  flexible: Joi.boolean().default(false),
  minutes: Joi.number().integer().min(1).max(180).when("flexible", {
    is: true,
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  description: Joi.string().trim().allow("").max(300).optional(),
}).unknown(false);

const policyUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(60).optional(),
  flexible: Joi.boolean().optional(),
  minutes: Joi.number().integer().min(1).max(180).optional(),
  description: Joi.string().trim().allow("").max(300).optional(),
  published: Joi.boolean().optional(),
}).unknown(false);

const liveQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").optional(),
  department: Joi.string().trim().allow("").optional(),
  shiftId: optionalId,
  status: Joi.string().trim().allow("").optional(),
  companyId: optionalId,
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

const historyQuerySchema = liveQuerySchema.keys({
  breakType: Joi.string().trim().allow("").optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

const reviewSchema = Joi.object({
  decision: Joi.string().valid("approve", "reject").required().messages({
    "any.only": "decision must be approve or reject",
  }),
  remarks: Joi.string().trim().allow("").max(300).optional(),
}).unknown(false);

module.exports = {
  startSchema,
  liveQuerySchema,
  historyQuerySchema,
  reviewSchema,
  policySchema,
  policyUpdateSchema,
};
