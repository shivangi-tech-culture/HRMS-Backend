/**
 * HIERARCHY VALIDATION (Joi) — /api/hierarchy assign / unassign
 */
const Joi = require("joi");

const objectId = () => Joi.string().hex().length(24);
const employeeIds = () =>
  Joi.array().items(objectId()).min(1).max(500).unique().required();

/** POST /api/hierarchy/assign — { managerId, employeeIds, level? } */
const assignSchema = Joi.object({
  managerId: objectId().required(),
  employeeIds: employeeIds(),
  level: Joi.number().valid(1, 2).default(1),
}).unknown(false);

/** POST /api/hierarchy/unassign — { employeeIds, managerId?, level? } */
const unassignSchema = Joi.object({
  employeeIds: employeeIds(),
  managerId: objectId().optional(),
  level: Joi.number().valid(1, 2).optional(),
}).unknown(false);

module.exports = { assignSchema, unassignSchema };
