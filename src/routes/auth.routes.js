/**
 * AUTH ROUTES → /api/auth
 * POST /login · POST /logout · GET /token-status
 * POST /forgot-password · POST /reset-password (public)
 * Forgot / reset live only here (not mounted separately in server.js).
 */
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  login,
  logout,
  tokenStatus,
  forgotPassword,
  resetPassword,
} = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../validators/user.validation");

const router = express.Router();

/** Same window/max as login — stops reset-email spam */
const authSensitiveLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many attempts. Please try again later.",
  },
});

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Login with one `username` (employee code / email / mobile) + password (JWT in httpOnly cookie)
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     description: |
 *       Body has only two fields: `username` and `password`.
 *       `username` can be any of these — the server detects which:
 *       - contains `@` → official email or personal email
 *       - 10-digit number (`+91` / spaces allowed) → personal mobile number
 *       - anything else → employee code (case-insensitive, e.g. `tc005`)
 *       Sets httpOnly cookie `token` (primary). Also returns `token` for Swagger Bearer.
 *       `permissionCount` = `"granted of max"` (true action flags / role catalog total).
 *       `permissions` = only **true** actions (false keys omitted).
 *
 *       **Seed:** Super Admin / Admin → `123456`.
 *       Staff → `{employeeCode}{ddmmyyyy}` e.g. `TC00515012005` (DOB 15/01/2005).
 *       Company code `TC` → codes `TC001`…
 *       - anupama@techculture.ai / TC001 — HR
 *       - manav / manoj @techculture.ai — Managers TC002–003
 *       - shivangi / employee / vivek / ananya — Employees TC004–007
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginBody'
 *           examples:
 *             employeeCode:
 *               value:
 *                 username: TC005
 *                 password: "TC00515012005"
 *             email:
 *               value:
 *                 username: employee@techculture.ai
 *                 password: "TC00515012005"
 *             mobile:
 *               value:
 *                 username: "9876500002"
 *                 password: "TC00515012005"
 *             platformAdmin:
 *               value:
 *                 username: superadmin@gmail.com
 *                 password: "123456"
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
// LOGIN — public; body: username (code | email | mobile) + password
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

/**
 * @swagger
 * /api/auth/token-status:
 *   get:
 *     tags: [Auth]
 *     summary: Check token (expired / other device login)
 *     description: |
 *       Pass JWT in header only: `Authorization: Bearer <token>` (or cookie `token`).
 *       Returns `message` + `isExpired` + `isReplaced`.
 *       Both booleans `false` = token valid.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *         example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: message, isExpired, isReplaced
 *       400:
 *         description: token missing from header
 */
router.get("/token-status", tokenStatus);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Forgot password (send reset email)
 *     description: |
 *       Public. Body: `{ "email": "shivangi@techculture.ai" }`.
 *       Looks up official or personal email. Always returns the same success message
 *       (does not reveal whether the account exists).
 *       Email contains a one-time link valid for **1 hour**.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *           example:
 *             email: shivangi@techculture.ai
 *     responses:
 *       200:
 *         description: Generic success message
 *       400:
 *         description: Validation failed
 */
// FORGOT PASSWORD — public; body: { email }
router.post(
  "/forgot-password",
  authSensitiveLimiter,
  validate(forgotPasswordSchema),
  forgotPassword
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password with email token
 *     description: |
 *       Public. Body: `{ "token", "newPassword", "confirmPassword" }`.
 *       `token` comes from the forgot-password email link (`?token=`).
 *       On success the session JWT is cleared — user must log in again.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword, confirmPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string, minLength: 6, maxLength: 50 }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid/expired token or validation error
 */
// RESET PASSWORD — public; body: { token, newPassword, confirmPassword }
router.post(
  "/reset-password",
  authSensitiveLimiter,
  validate(resetPasswordSchema),
  resetPassword
);

module.exports = router;
