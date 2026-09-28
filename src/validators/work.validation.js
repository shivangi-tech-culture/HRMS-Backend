/**
 * HOLIDAY / WORK TIMING / WEEKLY OFF validation
 */
const Joi = require("joi");
const { HOLIDAY_TYPES } = require("../models/Holiday");
const { WEEK_DAYS } = require("../models/WeeklyOff");

const dateStr = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });

const createHolidaySchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  date: dateStr.required(),
  type: Joi.string()
    .valid(...HOLIDAY_TYPES)
    .default("DECLARED HOLIDAY"),
  forAudience: Joi.string().trim().allow("").max(100).default("All Employees"),
  applicableOn: Joi.string().trim().allow("").max(200).optional(),
  company: Joi.string().trim().allow("").max(200).optional(),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  description: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const updateHolidaySchema = createHolidaySchema
  .fork(["name", "date"], (s) => s.optional())
  .min(1)
  .unknown(false);

const listHolidayQuerySchema = Joi.object({
  year: Joi.number().integer().min(2000).max(2100).optional(),
  type: Joi.string()
    .valid(...HOLIDAY_TYPES, "All")
    .optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  company: Joi.string().trim().allow("").optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

const createWorkTimingSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  code: Joi.string().trim().uppercase().min(1).max(20).required(),
  company: Joi.string().trim().allow("").max(200).optional(),
  whCalculation: Joi.string().trim().min(2).max(50).default("Shift Based"),
  graceTimeMins: Joi.number().integer().min(0).max(240).default(15),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  description: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const updateWorkTimingSchema = createWorkTimingSchema
  .fork(["name", "code"], (s) => s.optional())
  .min(1)
  .unknown(false);

const listWorkTimingQuerySchema = Joi.object({
  status: Joi.string().valid("Active", "Inactive").optional(),
  company: Joi.string().trim().allow("").optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

const createWeeklyOffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  code: Joi.string().trim().uppercase().min(1).max(20).required(),
  company: Joi.string().trim().allow("").max(200).optional(),
  workingDays: Joi.number().integer().min(1).max(7).default(5),
  weekStartsOn: Joi.string()
    .valid(...WEEK_DAYS)
    .default("Monday"),
  offDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .optional(),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  description: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const updateWeeklyOffSchema = createWeeklyOffSchema
  .fork(["name", "code"], (s) => s.optional())
  .min(1)
  .unknown(false);

const listWeeklyOffQuerySchema = listWorkTimingQuerySchema;

module.exports = {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidayQuerySchema,
  createWorkTimingSchema,
  updateWorkTimingSchema,
  listWorkTimingQuerySchema,
  createWeeklyOffSchema,
  updateWeeklyOffSchema,
  listWeeklyOffQuerySchema,
};
