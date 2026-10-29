/**
 * TASK VALIDATION — project-scoped CRUD + assignee assign + employee status
 */
const Joi = require("joi");
const { PRIORITIES, STATUSES } = require("../models/Task");

const objectId = Joi.string().hex().length(24);

const isRealDate = (value, helpers) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return helpers.message("Date must be a real calendar date, like 2026-10-14");
  }
  return value;
};

const dueDateField = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom(isRealDate);

/** Accept one id or array of ids → always array. */
const assigneesField = Joi.alternatives()
  .try(objectId, Joi.array().items(objectId).unique())
  .custom((value) => (Array.isArray(value) ? value : [value]));

const createTaskSchema = Joi.object({
  title: Joi.string().trim().min(2).max(200).required(),
  description: Joi.string().trim().allow("").max(2000).default(""),
  projectId: objectId.required(),
  /** Optional — must match project's company if sent. */
  companyId: objectId.optional(),
  assignees: assigneesField.default([]),
  dueDate: dueDateField.allow("").default(""),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .default("Medium"),
  status: Joi.string()
    .valid(...STATUSES)
    .default("To Do"),
}).unknown(false);

const updateTaskSchema = Joi.object({
  title: Joi.string().trim().min(2).max(200).optional(),
  description: Joi.string().trim().allow("").max(2000).optional(),
  projectId: objectId.optional(),
  assignees: assigneesField.optional(),
  dueDate: dueDateField.allow("").optional(),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .optional(),
  status: Joi.string()
    .valid(...STATUSES)
    .optional(),
})
  .min(1)
  .unknown(false);

const listTaskQuerySchema = Joi.object({
  companyId: objectId.optional(),
  projectId: objectId.optional(),
  assignee: objectId.optional(),
  status: Joi.string()
    .valid(...STATUSES, "Over Due", "ALL")
    .optional(),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const myTaskQuerySchema = Joi.object({
  projectId: objectId.optional(),
  status: Joi.string()
    .valid(...STATUSES, "Over Due", "ALL")
    .optional(),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/** Task Dashboard widgets — days window + optional project/category filter. */
const myTaskDashboardQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(90).default(15),
  category: Joi.string().trim().allow("").default("ALL"),
  projectId: objectId.optional(),
  listLimit: Joi.number().integer().min(1).max(50).default(10),
}).unknown(true);

/** Employee creates a task under a company project (auto-assigns self). */
const createMyTaskSchema = Joi.object({
  title: Joi.string().trim().min(2).max(200).required(),
  description: Joi.string().trim().allow("").max(2000).default(""),
  projectId: objectId.required(),
  dueDate: dueDateField.allow("").default(""),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .default("Medium"),
}).unknown(false);

const employeeStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...STATUSES)
    .required(),
}).unknown(false);

const assignTaskSchema = Joi.object({
  assigneeIds: Joi.array().items(objectId).min(1).unique().required(),
  mode: Joi.string().valid("add", "remove", "replace").default("add"),
}).unknown(false);

module.exports = {
  createTaskSchema,
  updateTaskSchema,
  listTaskQuerySchema,
  myTaskQuerySchema,
  myTaskDashboardQuerySchema,
  createMyTaskSchema,
  employeeStatusSchema,
  assignTaskSchema,
};
