/**
 * PROJECT VALIDATION — company-scoped CRUD + member assign
 */
const Joi = require("joi");
const { PROJECT_STATUSES } = require("../models/Project");

const objectId = Joi.string().hex().length(24);

const createProjectSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().allow("").max(2000).default(""),
  companyId: objectId.required(),
  status: Joi.string()
    .valid(...PROJECT_STATUSES)
    .default("Active"),
  /** Optional members on create — same as Assign with mode replace. */
  memberIds: Joi.array().items(objectId).unique().default([]),
}).unknown(false);

const updateProjectSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  description: Joi.string().trim().allow("").max(2000).optional(),
  status: Joi.string()
    .valid(...PROJECT_STATUSES)
    .optional(),
})
  .min(1)
  .unknown(false);

const listProjectQuerySchema = Joi.object({
  companyId: objectId.optional(),
  status: Joi.string()
    .valid(...PROJECT_STATUSES, "ALL")
    .optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const assignProjectSchema = Joi.object({
  employeeIds: Joi.array().items(objectId).min(1).unique().required(),
  mode: Joi.string().valid("add", "remove", "replace").default("add"),
}).unknown(false);

module.exports = {
  createProjectSchema,
  updateProjectSchema,
  listProjectQuerySchema,
  assignProjectSchema,
};
