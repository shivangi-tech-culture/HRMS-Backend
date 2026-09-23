/**
 * Attendance routes → /api/attendance
 *
 * Self punch-in/out require source: web | mobile | biometric
 * Manual mark (admin) always stores source = manual
 */
const express = require("express");
const {
  punchIn,
  punchOut,
  markManual,
  myToday,
  listAttendance,
} = require("../controllers/attendance.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  punchSchema,
  manualMarkSchema,
} = require("../validators/attendance.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Attendance
 *     description: Punch in/out with source (web, mobile, biometric) + admin manual mark
 */

/**
 * @swagger
 * /api/attendance/punch-in:
 *   post:
 *     tags: [Attendance]
 *     summary: Punch in (self)
 *     description: |
 *       **Employee self punch** — source must be `web` | `mobile` | `biometric`.
 *       `manual` is NOT allowed here (admin Mark Attendance only, if punch was missed).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PunchBody'
 *     responses:
 *       201:
 *         description: Punched in successfully
 *       400:
 *         description: Already punched in / validation failed
 */
router.post("/punch-in", protect, validate(punchSchema), punchIn);

/**
 * @swagger
 * /api/attendance/punch-out:
 *   post:
 *     tags: [Attendance]
 *     summary: Punch out (self)
 *     description: |
 *       Same as punch-in — employee: web | mobile | biometric only (not manual).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PunchBody'
 *     responses:
 *       200:
 *         description: Punched out successfully
 *       400:
 *         description: Not punched in / already out / validation failed
 */
router.post("/punch-out", protect, validate(punchSchema), punchOut);

/**
 * @swagger
 * /api/attendance/manual:
 *   post:
 *     tags: [Attendance]
 *     summary: Mark Attendance (admin manual)
 *     description: |
 *       **Admin only** (Super Admin / HR Manager / Manager) — when employee missed punch.
 *       Employees cannot call this. Date is always today. Source forced to `manual`.
 *       UI uses punchInSource / punchOutSource (no separate verification field).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ManualAttendanceBody'
 *     responses:
 *       201:
 *         description: Manual attendance saved
 *       400:
 *         description: Validation / punch-out before punch-in
 *       403:
 *         description: Not admin
 */
router.post(
  "/manual",
  protect,
  authorize(...ALL_ACCESS),
  validate(manualMarkSchema),
  markManual
);

/**
 * @swagger
 * /api/attendance/today:
 *   get:
 *     tags: [Attendance]
 *     summary: My today punch
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today record or null
 */
router.get("/today", protect, myToday);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     tags: [Attendance]
 *     summary: List attendance
 *     description: |
 *       Admin → all | Employee → own.
 *       Query optional: `date=YYYY-MM-DD`, `source=web|mobile|biometric|manual`
 *       (matches punchInSource OR punchOutSource)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AttendanceDate'
 *       - $ref: '#/components/parameters/AttendanceSource'
 *     responses:
 *       200:
 *         description: Attendance list
 */
router.get("/", protect, listAttendance);

module.exports = router;
