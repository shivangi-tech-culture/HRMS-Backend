/**
 * Master Joi — body shape only
 *
 * company:
 *   type=company → ignore / optional
 *   other types  → optional in Joi; controller sets it securely:
 *     Global Admin → required from body
 *     Super Admin / HR / Manager → always from login profile (not trusted from frontend)
 */
const Joi = require("joi");
const { TYPES } = require("../models/Master");

/** POST /api/masters */
const createMasterSchema = Joi.object({
  type: Joi.string()
    .valid(...TYPES)
    .required(),
  name: Joi.string().trim().min(1).max(150).required(),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  company: Joi.string().trim().max(150).allow("").optional(),
}).unknown(false);

/** PUT /api/masters/:id */
const updateMasterSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  // Only Global Admin may change parent company; others ignored in controller
  company: Joi.string().trim().max(150).allow("").optional(),
})
  .min(1)
  .unknown(false);

module.exports = { createMasterSchema, updateMasterSchema };
