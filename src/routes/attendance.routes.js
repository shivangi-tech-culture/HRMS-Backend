/**
 * ATTENDANCE ROUTES → mounted at /api/attendance
 * Self punch only (any logged-in user): punch-in · punch-out · today · web-punches
 */
const express = require("express");
const {
  punchIn,
  punchOut,
  myToday,
  listWebPunches,
} = require("../controllers/attendance.controller");
const { protect, hasAllAccess } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  punchSchema,
  webPunchQuerySchema,
} = require("../validators/attendance.validation");

const router = express.Router();

/**
 * @swagger
 * /api/attendance/punch-in:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch in (self)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PunchBody' }
 */
router.post("/punch-in", protect, validate(punchSchema), punchIn);

/**
 * @swagger
 * /api/attendance/punch-out:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch out (self) — computes Present / HalfDay / late / early
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PunchBody' }
 */
router.post("/punch-out", protect, validate(punchSchema), punchOut);

/**
 * @swagger
 * /api/attendance/today:
 *   get:
 *     tags: [Employee / ESS]
 *     summary: My today — today's record + shift timings
 *     security:
 *       - bearerAuth: []
 */
router.get("/today", protect, myToday);

/**
 * @swagger
 * /api/attendance/web-punches:
 *   get:
 *     tags: [Employee / ESS]
 *     summary: My punches — own IN / OUT rows (newest first)
 *     description: Employee needs Self → My Web Punches → view.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-10-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-10-31" }
 *       - in: query
 *         name: date
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 */
router.get(
  "/web-punches",
  protect,
  validateQuery(webPunchQuerySchema),
  (req, res, next) =>
    hasAllAccess(req.user)
      ? next()
      : checkPermission("Self", "My Web Punches", "view")(req, res, next),
  listWebPunches
);

module.exports = router;
