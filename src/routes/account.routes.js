/**
 * ACCOUNT ROUTES → /api/account
 * UI: /account/profile (Admin My Profile)
 */
const express = require("express");
const {
  getMyProfile,
  updateMyProfile,
  getMe,
  changePassword,
} = require("../controllers/account.controller");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const Joi = require("joi");

const router = express.Router();

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  profileUrl: Joi.string().uri().allow("", null).optional(),
  /** HR / Admin / Super Admin — Cloudinary url from upload type=signature */
  signatureUrl: Joi.string().uri().allow("", null).optional(),
}).unknown(false);

const changePasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).max(50).required().messages({
    "string.min": "New password must be at least 6 characters",
    "string.max": "New password must be at most 50 characters",
    "string.empty": "New password is required",
    "any.required": "New password is required",
  }),
  confirmPassword: Joi.string().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "New password and confirm password do not match",
    "string.empty": "Confirm password is required",
    "any.required": "Confirm password is required",
  }),
}).unknown(false);

/**
 * @swagger
 * tags:
 *   - name: Account / My Profile
 *     description: Logged-in user profile (Admin + ESS)
 */

/**
 * @swagger
 * /api/account/profile:
 *   get:
 *     tags: [Account / My Profile]
 *     summary: My Profile (current login)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Profile cards — name, email, role, company, department, status
 */
router.get("/profile", protect, getMyProfile);

/**
 * @swagger
 * /api/account/profile:
 *   put:
 *     tags: [Account / My Profile]
 *     summary: Update my display name / profileUrl
 *     security: [{ bearerAuth: [] }]
 */
router.put("/profile", protect, validate(updateProfileSchema), updateMyProfile);

/** Alias used by some frontends */
router.get("/me", protect, getMe);

/**
 * @swagger
 * /api/account/change-password:
 *   post:
 *     tags: [Account / My Profile]
 *     summary: Change my password
 *     description: |
 *       Logged-in employee (or any role) changes their own password.
 *       Body: `newPassword` + `confirmPassword` only (6–50 chars, must match).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword, confirmPassword]
 *             properties:
 *               newPassword: { type: string, minLength: 6, maxLength: 50 }
 *               confirmPassword: { type: string }
 *           example:
 *             newPassword: "MyNewPass123"
 *             confirmPassword: "MyNewPass123"
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Validation failed / passwords do not match }
 */
router.post(
  "/change-password",
  protect,
  validate(changePasswordSchema),
  changePassword
);

module.exports = router;