/**
 * SHIFT VALIDATION — master + assignment (UI Shift Management / Assignments)
 */
const Joi = require("joi");
const { TIME_RE } = require("../models/Shift");

const timeField = Joi.string()
  .pattern(TIME_RE)
  .messages({ "string.pattern.base": "time must be HH:mm (24h), e.g. 09:00" });

const createShiftSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(20).required(),
  name: Joi.string().trim().min(2).max(100).required(),
  company: Joi.string().trim().allow("").max(200).optional(),
  punchStartTime: timeField.default("08:00"),
  startTime: timeField.required(),
  endTime: timeField.required(),
  shiftDuration: Joi.number().min(0).max(24).optional(),
  workDuration: Joi.number().min(0).max(24).optional(),
  breakApplicable: Joi.boolean().default(false),
  nightShift: Joi.boolean().default(false),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  halfDayEndTime: timeField.default("14:30"),
  graceMinutes: Joi.number().integer().min(0).max(240).default(0),
  allowEarlyPunchIn: Joi.boolean().default(true),
  allowLatePunchOut: Joi.boolean().default(true),
  weeklyOffDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .default([0]),
  halfDayDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .default([6]),
  description: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const updateShiftSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(20).optional(),
  name: Joi.string().trim().min(2).max(100).optional(),
  company: Joi.string().trim().allow("").max(200).optional(),
  punchStartTime: timeField.optional(),
  startTime: timeField.optional(),
  endTime: timeField.optional(),
  shiftDuration: Joi.number().min(0).max(24).optional(),
  workDuration: Joi.number().min(0).max(24).optional(),
  breakApplicable: Joi.boolean().optional(),
  nightShift: Joi.boolean().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  halfDayEndTime: timeField.optional(),
  graceMinutes: Joi.number().integer().min(0).max(240).optional(),
  allowEarlyPunchIn: Joi.boolean().optional(),
  allowLatePunchOut: Joi.boolean().optional(),
  weeklyOffDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .optional(),
  halfDayDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .optional(),
  description: Joi.string().trim().allow("").max(500).optional(),
})
  .min(1)
  .unknown(false);

const listShiftQuerySchema = Joi.object({
  status: Joi.string().valid("Active", "Inactive").optional(),
  company: Joi.string().trim().allow("").optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

const assignShiftSchema = Joi.object({
  employeeId: Joi.string().hex().length(24).required(),
  shiftId: Joi.string().hex().length(24).required(),
  /** Work → Weekly Off policy id (GET /api/weekly-offs) */
  weeklyOffId: Joi.string().hex().length(24).required(),
  effectiveFrom: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({ "string.pattern.base": "effectiveFrom must be YYYY-MM-DD" }),
  effectiveTo: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(null, "")
    .optional(),
  remarks: Joi.string().trim().allow("").max(500).optional(),
}).unknown(false);

const updateAssignmentSchema = Joi.object({
  shiftId: Joi.string().hex().length(24).optional(),
  weeklyOffId: Joi.string().hex().length(24).optional(),
  effectiveFrom: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  effectiveTo: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(null, "")
    .optional(),
  remarks: Joi.string().trim().allow("").max(500).optional(),
})
  .min(1)
  .unknown(false);

const listAssignmentQuerySchema = Joi.object({
  employeeId: Joi.string().hex().length(24).optional(),
  shiftId: Joi.string().hex().length(24).optional(),
  company: Joi.string().trim().allow("").optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
}).unknown(true);

module.exports = {
  createShiftSchema,
  updateShiftSchema,
  listShiftQuerySchema,
  assignShiftSchema,
  updateAssignmentSchema,
  listAssignmentQuerySchema,
};
