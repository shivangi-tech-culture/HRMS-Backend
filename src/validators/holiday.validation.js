/**
 * HOLIDAY VALIDATION — catalog fields + bulk company assignment
 */
const Joi = require("joi");

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

const createHolidaySchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  date: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).required().custom(isRealDate),
  description: Joi.string().trim().allow("").max(500).default(""),
  isActive: Joi.boolean().default(true),
}).unknown(false);

const updateHolidaySchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  date: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().custom(isRealDate),
  description: Joi.string().trim().allow("").max(500).optional(),
  isActive: Joi.boolean().optional(),
})
  .min(1)
  .unknown(false);

const listHolidayQuerySchema = Joi.object({
  companyId: objectId.optional(),
  year: Joi.number().integer().min(2000).max(2100).optional(),
  from: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isActive: Joi.boolean().optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const myHolidayQuerySchema = Joi.object({
  year: Joi.number().integer().min(2000).max(2100).optional(),
  from: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isActive: Joi.boolean().optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/** Add, remove, or replace company ids on many holidays at once. */
const assignHolidaySchema = Joi.object({
  holidayIds: Joi.array().items(objectId).min(1).unique().required(),
  companyIds: Joi.array().items(objectId).min(1).unique().required(),
  mode: Joi.string().valid("add", "remove", "replace").default("add"),
}).unknown(false);

module.exports = {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidayQuerySchema,
  myHolidayQuerySchema,
  assignHolidaySchema,
};
