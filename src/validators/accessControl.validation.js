/**
 * ACCESS & CONTROL VALIDATION (Joi) — /api/users
 * Hierarchy: Super Admin → Admin → HR Manager / Reporting Manager → Employee
 */
const Joi = require("joi");

const str = () => Joi.string().trim().allow("").optional();
const phoneOpt = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{10}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a 10-digit phone number" });

const only = (keys) => Joi.object(keys).unknown(false);

const companyObjectId = Joi.string().hex().length(24);
const companyIdsField = Joi.array().items(companyObjectId).min(1).max(50);

/** Super Admin / Admin — lean platform account */
const officialPlatform = only({
  officialEmail: Joi.string().trim().email().required(),
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  department: Joi.string().trim().allow("").optional(),
});

/**
 * HR / Reporting Manager / Employee.
 * Everyone sends official.companyIds.
 * Employee and Reporting Manager: exactly one id. HR: one or more.
 */
const officialStaff = only({
  officialEmail: Joi.string().trim().email().required(),
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  companyIds: companyIdsField.optional(),
  department: Joi.string().trim().allow("").optional(),
  branchId: Joi.string().hex().length(24).allow("", null).optional(),
  shiftId: Joi.string().hex().length(24).allow("", null).optional(),
});

const personalAccessLean = only({
  mobileNo: phoneOpt(),
  presentAddress: only({
    city: str(),
    state: str(),
    country: str(),
  }).optional(),
});

const createAccessUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  password: Joi.string().min(6).max(50).required(),
  role: Joi.string().trim().required(),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  official: Joi.when("role", {
    is: Joi.valid("Super Admin", "Admin"),
    then: officialPlatform.required(),
    otherwise: officialStaff.required(),
  }),
  personal: personalAccessLean.optional(),
}).unknown(false);

const updateAccessUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  password: Joi.string().min(6).max(50).allow("").optional(),
  role: Joi.string().trim().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  official: only({
    employeeCode: Joi.string().trim().uppercase().allow("").optional(),
    department: str(),
    companyIds: companyIdsField.optional(),
    branchId: Joi.string().hex().length(24).allow("", null).optional(),
    shiftId: Joi.string().hex().length(24).allow("", null).optional(),
  }).optional(),
  personal: personalAccessLean.optional(),
})
  .min(1)
  .unknown(false);

const accessSendMailSchema = Joi.object({
  subject: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().min(1).max(20000).required(),
  isHtml: Joi.boolean().default(false),
}).unknown(false);

/** Super Admin assigns the full company list on an HR Manager. */
const assignHrCompaniesSchema = Joi.object({
  companyIds: companyIdsField.required(),
}).unknown(false);

module.exports = {
  createAccessUserSchema,
  updateAccessUserSchema,
  accessSendMailSchema,
  assignHrCompaniesSchema,
};
