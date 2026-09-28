/**
 * ACCESS & CONTROL VALIDATION (Joi) — /api/users
 * Lean create / update — UI drawer fields only.
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

const officialGlobalAdmin = only({
  officialEmail: Joi.string().trim().email().required(),
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  company: Joi.string().trim().allow("").optional(),
  department: Joi.string().trim().allow("").optional(),
});

const officialSuperAdmin = only({
  officialEmail: Joi.string().trim().email().required(),
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  company: Joi.string().trim().min(2).allow("").optional(),
  department: Joi.string().trim().allow("").optional(),
});

const officialAccessStaff = only({
  officialEmail: Joi.string().trim().email().required(),
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  company: Joi.string().trim().min(2).required(),
  department: Joi.string().trim().allow("").optional(),
});

const personalAccessLean = only({
  mobileNo: phoneOpt(),
  presentAddress: only({
    city: str(),
    state: str(),
    country: str(),
  }).optional(),
});

/** CREATE — POST /api/users */
const createAccessUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  password: Joi.string().min(6).max(50).required(),
  role: Joi.string().trim().required(),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  official: Joi.when("role", {
    is: "Global Admin",
    then: officialGlobalAdmin.required(),
    otherwise: Joi.when("role", {
      is: "Super Admin",
      then: officialSuperAdmin.required(),
      otherwise: officialAccessStaff.required(),
    }),
  }),
  personal: personalAccessLean.optional(),
}).unknown(false);

/**
 * UPDATE — PUT /api/users/:id
 * Email + company immutable (not in schema).
 */
const updateAccessUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  password: Joi.string().min(6).max(50).allow("").optional(),
  role: Joi.string().trim().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  official: only({
    employeeCode: Joi.string().trim().uppercase().allow("").optional(),
    department: str(),
  }).optional(),
  personal: personalAccessLean.optional(),
})
  .min(1)
  .unknown(false);

/** SEND MAIL — POST /api/users/:id/mail (row mail icon) */
const accessSendMailSchema = Joi.object({
  subject: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().min(1).max(20000).required(),
  isHtml: Joi.boolean().default(false),
}).unknown(false);

module.exports = {
  createAccessUserSchema,
  updateAccessUserSchema,
  accessSendMailSchema,
};
