const Joi = require("joi");

const registerTokenSchema = Joi.object({
  token: Joi.string().trim().min(20).max(4096).required(),
  platform: Joi.string().valid("web", "android", "ios").default("web"),
  deviceId: Joi.string().trim().max(200).allow("").optional(),
}).unknown(false);

const removeTokenSchema = Joi.object({
  token: Joi.string().trim().min(20).max(4096).required(),
}).unknown(false);

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  unread: Joi.boolean().truthy("true").falsy("false").optional(),
  type: Joi.string().trim().optional(),
}).unknown(false);

module.exports = {
  registerTokenSchema,
  removeTokenSchema,
  listQuerySchema,
};
