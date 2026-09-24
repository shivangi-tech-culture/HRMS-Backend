/**
 * Auth routes → /api/auth
 *
 * Public: POST /login (no token)
 *
 * Flow: validate(Joi) → controller
 */
const express = require("express");
const { login } = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const { loginSchema } = require("../validators/user.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Login with official email and password
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

module.exports = router;
