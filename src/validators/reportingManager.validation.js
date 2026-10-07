/**
 * REPORTING MANAGER VALIDATION (Joi) — POST /api/employees/assign-manager, POST /api/users/assign-manager
 */
const Joi = require("joi");

const objectId = () => Joi.string().hex().length(24);

/** { companyId, managerId (null = remove), employeeIds, level? } */
const assignManagerSchema = Joi.object({
  companyId: objectId().required(),
  managerId: objectId().allow(null).required(),
  employeeIds: Joi.array().items(objectId()).min(1).max(500).unique().required(),
  level: Joi.number().valid(1, 2).optional(),
}).unknown(false);

module.exports = { assignManagerSchema };
