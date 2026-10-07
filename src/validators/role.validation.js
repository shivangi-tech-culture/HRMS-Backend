/**
 * ROLE VALIDATION (Joi) — create role · save permissions
 */
const Joi = require("joi");

/** Required boolean for each permission action flag */
const bool = () => Joi.boolean().required();

/** All action flags a subModule must declare (view, create, edit, …) */
const actionFlags = {
  view: bool(),
  create: bool(),
  edit: bool(),
  delete: bool(),
  approve: bool(),
  reject: bool(),
  download: bool(),
  export: bool(),
  import: bool(),
  upload: bool(),
  print: bool(),
  email: bool(),
  share: bool(),
  cancel: bool(),
  assign: bool(),
};

/**
 * One subModule row — name + every action flag
 * Example: { name: "Mail", view: true, create: false, … }
 */
const subModuleSchema = Joi.object({
  name: Joi.string().trim().required(),
  ...actionFlags,
});

/**
 * One permission block — module + heading + list of subModules
 * Example: { module: "Organization", heading: "Communication", subModules: […] }
 */
const permissionBlockSchema = Joi.object({
  module: Joi.string().trim().required(),
  heading: Joi.string().trim().allow("").required(),
  subModules: Joi.array().items(subModuleSchema).default([]),
});

/**
 * CREATE ROLE body — always admin catalog.
 * UI: load admin modules → hide/show (omit or all-false) → POST.
 * `catalog` optional (forced to admin server-side).
 */
const createRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().allow("").default(""),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  /** Ignored if sent — Create Role always uses admin tree */
  catalog: Joi.string().valid("admin").optional().default("admin"),
  /** Required: admin modules/actions (hide = omit or all false) */
  permissions: Joi.array().items(permissionBlockSchema).min(1).required(),
});

/**
 * UPDATE ROLE body — name cannot change
 */
const updateRoleSchema = Joi.object({
  name: Joi.any().forbidden().messages({
    "any.unknown": "Role name cannot be changed",
  }),
  description: Joi.string().trim().allow(""),
  status: Joi.string().valid("Active", "Inactive"),
}).min(1);

/**
 * SAVE PERMISSIONS body — hide/show within admin catalog (custom roles).
 * System Employee role keeps ESS; catalog forced admin for all others.
 */
const savePermissionsSchema = Joi.object({
  permissions: Joi.array().items(permissionBlockSchema).min(1).required(),
  /** Optional — ignored for custom roles (always admin). Employee system role uses employee. */
  catalog: Joi.string().valid("admin", "employee").optional(),
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  savePermissionsSchema,
};
