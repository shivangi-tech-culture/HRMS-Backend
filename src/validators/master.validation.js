/**
 * Master Joi — body + list query
 * Masters are global — company field ignored / stripped.
 */
const Joi = require("joi");
const { TYPES } = require("../models/Master");

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

const statusField = Joi.string().valid("Active", "Inactive").messages({
  "any.only": "status must be Active or Inactive",
});

/** POST /api/masters — company not needed */
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
  /** Accepted but ignored (masters are global) */
  company: Joi.string().trim().max(150).allow("").optional(),
}).unknown(false);

/** PUT /api/masters/:id */
const updateMasterSchema = Joi.object({
  name: masterName.optional(),
  status: statusField.optional(),
  company: Joi.string().trim().max(150).allow("").optional(),
})
  .min(1)
  .unknown(false)
  .messages({
    "object.min": "Provide at least one of: name, status",
  });

/** GET /api/masters query — company filter ignored */
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
