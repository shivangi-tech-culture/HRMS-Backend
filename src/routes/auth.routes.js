/**
 * AUTH ROUTES → /api/auth
 * POST /login (public) · POST /logout (public)
 */
const express = require("express");
const { login, logout } = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const { loginSchema } = require("../validators/user.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Login with official email and password (JWT in httpOnly cookie)
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     description: |
 *       Login with `officialEmail` + `password`.
 *       Sets httpOnly cookie `token` (primary). Also returns `token` for Swagger Bearer.
 *       `permissionCount` = `"granted of max"` (true action flags / role catalog total).
 *       `permissions` = only **true** actions (false keys omitted).
 *
 *       **Seed (password 123456):**
 *       - globaladmin@techculture.ai — Global Admin (all companies)
 *       - shivangi@techculture.ai — Super Admin (own company)
 *       - hr@techculture.ai — HR Manager
 *       - manager@techculture.ai — Manager
 *       - shivig5964@gmail.com — Employee
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
 *         description: Login ok. Sets httpOnly cookie named token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials or inactive account
 */
// LOGIN — public; body: officialEmail + password
router.post("/login", validate(loginSchema), login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout
 *     description: Clears the httpOnly `token` cookie.
 *     responses:
 *       200:
 *         description: Logged out
 */
// LOGOUT — public; clears cookie (no body required)
router.post("/logout", logout);

module.exports = router;
