/**
 * Master Joi — body + list query checks
 *
 * company:
 *   type=company → ignore / optional
 *   other types  → optional in Joi; controller sets it securely:
 *     Global Admin → required from body (+ must exist in company master)
 *     Super Admin / HR / Manager → always from login profile
 */
const Joi = require("joi");
const { TYPES } = require("../models/Master");

/** Name label for dropdowns — letters/digits + common punctuation */
const masterName = Joi.string()
  .trim()
  .min(1)
  .max(150)
  .pattern(/^[A-Za-z0-9][A-Za-z0-9 .,&'/()+_-]*$/)
  .messages({
    "string.empty": "name is required",
    "string.min": "name is required",
    "string.max": "name must be at most 150 characters",
    "string.pattern.base":
      "name may only contain letters, numbers, spaces, and .,&'()+_-",
    "any.required": "name is required",
  });

const statusField = Joi.string()
  .valid("Active", "Inactive")
  .messages({
    "any.only": "status must be Active or Inactive",
  });

/** POST /api/masters */
const createMasterSchema = Joi.object({
  type: Joi.string()
    .valid(...TYPES)
    .required()
    .messages({
      "any.only": `type must be one of: ${TYPES.join(", ")}`,
      "any.required": "type is required",
    }),
  name: masterName.required(),
  status: statusField.default("Active"),
  company: Joi.string().trim().max(150).allow("").optional(),
})
  .unknown(false)
  .custom((value, helpers) => {
    // type=company must not send a parent company
    if (value.type === "company" && value.company) {
      return helpers.message("company field is not allowed when type is company");
    }
    return value;
  });

/** PUT /api/masters/:id */
const updateMasterSchema = Joi.object({
  name: masterName.optional(),
  status: statusField.optional(),
  company: Joi.string().trim().max(150).allow("").optional(),
})
  .min(1)
  .unknown(false)
  .messages({
    "object.min": "Provide at least one of: name, status, company",
  });

/** GET /api/masters query */
const listMasterQuerySchema = Joi.object({
  type: Joi.string()
    .valid(...TYPES)
    .required()
    .messages({
      "any.only": `type must be one of: ${TYPES.join(", ")}`,
      "any.required": "type is required",
    }),
  status: statusField.optional(),
  company: Joi.string().trim().max(150).allow("").optional(),
  search: Joi.string().trim().max(150).allow("").optional(),
  q: Joi.string().trim().max(150).allow("").optional(),
  query: Joi.string().trim().max(150).allow("").optional(),
  keyword: Joi.string().trim().max(150).allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(false);

module.exports = {
  createMasterSchema,
  updateMasterSchema,
  listMasterQuerySchema,
};
