/**
 * NOTIFICATION ROUTES → /api/notifications  (simple — 3 APIs)
 *
 * Mobile / Web flow:
 *   1. POST /api/auth/login          → JWT
 *   2. Get FCM device token (Firebase SDK)
 *   3. POST /api/notifications/token → save on User.fcmTokens[]
 *   4. Punch-in / other events can push to that token
 *
 * APIs:
 *   POST /token     — register FCM (web | android | ios) right after login
 *   GET  /          — list (Employee own; RM team; HR company; Admin all)
 *   PUT  /:id/read  — mark read
 *
 * Profile alert: automatic on punch-in when profile % < 70 (no cron).
 * Login does NOT save FCM by itself — client must call POST /token after login.
 */
const express = require("express");
const { protect } = require("../middleware/auth");
const { validate, validateQuery } = require("../middleware/validate");
const {
  registerTokenSchema,
  listQuerySchema,
} = require("../validators/notification.validation");
const {
  registerToken,
  listNotifications,
  markRead,
} = require("../controllers/notification.controller");
const Joi = require("joi");

const router = express.Router();

const adminListQuery = listQuerySchema.keys({
  userId: Joi.string().hex().length(24).optional(),
});

/**
 * @swagger
 * tags:
 *   - name: Notifications
 *     description: |
 *       FCM web/mobile + bell list.
 *       After login, client MUST call POST /api/notifications/token with the device FCM token.
 *       Profile alert fires on punch-in if completion % under 70.
 */

/**
 * @swagger
 * /api/notifications/token:
 *   post:
 *     tags: [Notifications]
 *     summary: Register FCM device token (call right after login)
 *     description: |
 *       **When:** Immediately after successful login (web or mobile).
 *       Login JWT alone does not store FCM — app gets Firebase token, then this API saves it on `User.fcmTokens`.
 *       Same `deviceId` replaces the previous token for that device.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: FCM registration token from Firebase SDK }
 *               platform: { type: string, enum: [web, android, ios], default: web }
 *               deviceId: { type: string, description: Stable device id so re-login updates same row }
 *           example:
 *             token: "fcm_device_token_here"
 *             platform: android
 *             deviceId: "pixel-7-shivangi"
 *     responses:
 *       200: { description: Token saved on user }
 */
router.post("/token", protect, validate(registerTokenSchema), registerToken);

/** 2. List notifications */
router.get("/", protect, validateQuery(adminListQuery), listNotifications);

/** 3. Mark one as read */
router.put("/:id/read", protect, markRead);

module.exports = router;
