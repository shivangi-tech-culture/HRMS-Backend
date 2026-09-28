/**
 * ATTENDANCE ROUTES → /api/attendance
 * Punch in/out, manual mark, today, list
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
 *   - name: Admin / Attendance
 *     description: Manual mark + attendance list (admin)
 *   - name: Employee / ESS
 *     description: Punch in/out + my today (self)
 */

/**
 * @swagger
 * /api/attendance/punch-in:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch in (self — any role)
 *     description: |
 *       **Any logged-in role** (Employee, HR Manager, Manager, Super Admin, Global Admin)
 *       can punch in for **themselves**.
 *       Source: `web` | `mobile` | `biometric` only (`manual` = admin Mark Attendance).
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
// PUNCH IN — any role, self only; body: { source }
router.post("/punch-in", protect, validate(punchSchema), punchIn);

/**
 * @swagger
 * /api/attendance/punch-out:
 *   post:
 *     tags: [Employee / ESS]
 *     summary: Punch out (self — any role)
 *     description: |
 *       Same as punch-in — **any role** punches out for self.
 *       Source: web | mobile | biometric only (not manual).
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
// PUNCH OUT — any role, self only; body: { source }
router.post("/punch-out", protect, validate(punchSchema), punchOut);

/**
 * @swagger
 * /api/attendance/manual:
 *   post:
 *     tags: [Admin / Attendance]
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
// MANUAL MARK — admin only; source forced to "manual"
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
 *     tags: [Employee / ESS]
 *     summary: My today punch
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today record or null
 */
// MY TODAY — current user’s punch for today
router.get("/today", protect, myToday);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     tags: [Admin / Attendance]
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
// LIST ATTENDANCE — optional query: date, source
router.get("/", protect, listAttendance);

module.exports = router;
