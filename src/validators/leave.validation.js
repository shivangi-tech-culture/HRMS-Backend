/**
 * LEAVE VALIDATION (Joi)
 */
const Joi = require("joi");

const objectId = Joi.string().hex().length(24);
const ymd = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be YYYY-MM-DD" });
const ym = Joi.string()
  .pattern(/^\d{4}-\d{2}$/)
  .messages({ "string.pattern.base": "month must be YYYY-MM" });

const listQuery = {
  companyId: objectId.optional(),
  scope: Joi.string().valid("common", "company").optional(),
  search: Joi.string().trim().allow("").optional(),
  department: Joi.string().trim().allow("").optional(),
  status: Joi.string().trim().allow("").optional(),
  leaveTypeId: objectId.optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
};

const typeBody = Joi.object({
  scope: Joi.string().valid("common", "company").optional(),
  companyId: objectId.optional(),
  name: Joi.string().trim().min(2).max(80).required(),
  code: Joi.string().trim().min(1).max(10).required(),
  paid: Joi.boolean().required(),
  maxDays: Joi.number().min(0).max(366).required(),
  carryForward: Joi.boolean().required(),
  status: Joi.string().valid("Active", "Inactive").optional(),
});

const typePatch = Joi.object({
  companyId: objectId.optional(),
  name: Joi.string().trim().min(2).max(80).optional(),
  code: Joi.string().trim().min(1).max(10).optional(),
  paid: Joi.boolean().optional(),
  maxDays: Joi.number().min(0).max(366).optional(),
  carryForward: Joi.boolean().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
}).or("name", "code", "paid", "maxDays", "carryForward", "status");

const defaultsBody = Joi.object({
  scope: Joi.string().valid("common", "company").optional(),
  companyId: objectId.optional(),
});

const applyBody = Joi.object({
  employeeId: objectId.optional(),
  leaveTypeId: objectId.required(),
  from: ymd.required(),
  to: ymd.required(),
  dayType: Joi.string().valid("Full Day", "Half Day").default("Full Day"),
  reason: Joi.string().trim().min(1).max(1000).required(),
  document: Joi.string().trim().allow("").max(500).optional(),
});

const reviewBody = Joi.object({
  reason: Joi.string().trim().allow("").max(500).optional(),
});

const adjustBody = Joi.object({
  employeeId: objectId.required(),
  leaveTypeId: objectId.required(),
  days: Joi.number().positive().max(30).required(),
  reason: Joi.string().trim().min(1).max(300).required(),
});

const calendarQuery = Joi.object({
  companyId: objectId.optional(),
  month: ym.optional(),
  date: ymd.optional(),
  search: Joi.string().trim().allow("").optional(),
});

const policyBody = Joi.object({
  scope: Joi.string().valid("common", "company").optional(),
  companyId: objectId.optional(),
  label: Joi.string().trim().min(2).max(80).required(),
  value: Joi.string().trim().max(80).required(),
  description: Joi.string().trim().allow("").max(300).optional(),
});

const policyPatch = Joi.object({
  companyId: objectId.optional(),
  label: Joi.string().trim().min(2).max(80).optional(),
  value: Joi.string().trim().max(80).optional(),
  description: Joi.string().trim().allow("").max(300).optional(),
}).or("label", "value", "description");

module.exports = {
  typeListQuery: Joi.object(listQuery),
  typeBody,
  typePatch,
  defaultsBody,
  balanceQuery: Joi.object(listQuery),
  applyBody,
  reviewBody,
  adjustBody,
  requestQuery: Joi.object(listQuery),
  calendarQuery,
  policyQuery: Joi.object({ companyId: objectId.optional(), search: Joi.string().trim().allow("").optional() }),
  policyBody,
  policyPatch,
  historyQuery: Joi.object(listQuery),
};
