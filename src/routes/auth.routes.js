/**
 * Auth routes → /api/auth
 *
 * Public: login
 * Protected: me (current user)
 */
const express = require("express");
const { login, me } = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { loginSchema } = require("../validators/user.validation");

const router = express.Router();


/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Login, current user
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     description: Login with officialEmail + password. Returns JWT + permissions menu. Updates lastLogin.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [officialEmail, password]
 *             properties:
 *               officialEmail: { type: string, example: shivangi@techculture.ai }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Login ok }
 *       401: { description: Invalid credentials }
 */
router.post("/login", validate(loginSchema), login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current logged-in user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Profile + permissions + menu }
 */
router.get("/me", protect, me);

module.exports = router;
