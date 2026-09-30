/**
 * ACCOUNT ROUTES → /api/account
 * UI: /account/profile (Admin My Profile)
 */
const express = require("express");
const {
  getMyProfile,
  updateMyProfile,
  getMe,
} = require("../controllers/account.controller");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const Joi = require("joi");

const router = express.Router();

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  avatar: Joi.string().uri().allow("", null).optional(),
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
 *     summary: Update my display name / avatar
 *     security: [{ bearerAuth: [] }]
 */
router.put("/profile", protect, validate(updateProfileSchema), updateMyProfile);

/** Alias used by some frontends */
router.get("/me", protect, getMe);

module.exports = router;
