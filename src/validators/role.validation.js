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
 * CREATE ROLE body — permissions decided at create (required).
 * Pick one catalog: admin OR employee (not both).
 */
const createRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().allow("").default(""),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  /** Which master tree to validate against — one side only */
  catalog: Joi.string().valid("admin", "employee").required(),
  /** Required: modules/actions for this role (hide unused = omit or all false) */
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
 * SAVE PERMISSIONS body — hide/show modules within the chosen catalog
 */
const savePermissionsSchema = Joi.object({
  permissions: Joi.array().items(permissionBlockSchema).min(1).required(),
  /** admin | employee — required for custom roles when re-saving matrix */
  catalog: Joi.string().valid("admin", "employee").optional(),
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  savePermissionsSchema,
};
