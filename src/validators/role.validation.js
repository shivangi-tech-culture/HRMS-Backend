/**
 * Role request validation (Joi)
 *
 * Covers create/update role and saving permission blocks.
 */
const Joi = require("joi");

const createRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().allow("").default(""),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
});

const updateRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().allow(""),
  status: Joi.string().valid("Active", "Inactive"),
}).min(1);

const bool = () => Joi.boolean().required();

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

const subModuleSchema = Joi.object({
  name: Joi.string().trim().required(),
  ...actionFlags,
});

// Flat block: module + heading + subModules[]
const permissionBlockSchema = Joi.object({
  module: Joi.string().trim().required(),
  heading: Joi.string().trim().required(),
  subModules: Joi.array().items(subModuleSchema).default([]),
});

const savePermissionsSchema = Joi.object({
  permissions: Joi.array().items(permissionBlockSchema).min(1).required(),
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  savePermissionsSchema,
};
