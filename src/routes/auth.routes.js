/**
 * Auth routes → /api/auth
 *
 * Public:  POST /login  (no token)
 * Private: GET  /me     (needs Bearer token)
 *
 * Flow: validate(Joi) → controller
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
 *     description: Login and current user (no duplicate menu in responses)
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     description: |
 *       Login with `officialEmail` + `password`.
 *       Login ID = `official.officialEmail` on User.
 *       Returns JWT + user.permissions (single list — **no menu**).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginBody'
 *           example:
 *             officialEmail: shivangi@techculture.ai
 *             password: "123456"
 *     responses:
 *       200:
 *         description: Login ok
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials or inactive account
 */
router.post("/login", validate(loginSchema), login);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current logged-in user
 *     description: Returns user + permissions (single list — no menu)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile + permissions
 *       401:
 *         description: Missing or invalid token
 */
router.get("/me", protect, me);

module.exports = router;
