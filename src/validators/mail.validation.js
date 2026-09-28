/**
 * MAIL VALIDATION (Joi) — POST /api/mail/send body
 */
const Joi = require("joi");

/** Single required email address */
const emailOne = Joi.string().trim().email().required();

/** One email string or a non-empty array of emails (max 50) */
const emailList = Joi.alternatives()
  .try(emailOne, Joi.array().items(emailOne).min(1).max(50))
  .required();

/** Optional cc / bcc — same shapes as to when provided */
const optionalEmails = Joi.alternatives()
  .try(emailOne, Joi.array().items(emailOne).min(1).max(50))
  .optional();

/** SEND MAIL — POST /api/mail/send body */
const sendMailSchema = Joi.object({
  /** Primary recipient(s) */
  to: emailList,
  subject: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().min(1).max(50000).required(),
  cc: optionalEmails,
  bcc: optionalEmails,
  /** true → treat body as HTML */
  isHtml: Joi.boolean().optional().default(false),
})
  .min(1)
  .unknown(false);

module.exports = { sendMailSchema };
