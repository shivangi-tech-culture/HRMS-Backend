/**
 * BREAK APIs → /api/break
 *
 * Employee (login only — same idea as punch in / punch out)
 *   GET    /me                 today's button state
 *   POST   /start              { breakType: "Lunch Break" | "Day Break" }
 *   POST   /end                close my open break
 *
 * Admin — Live Break Status
 *   GET    /live               ?search=&department=&shiftId=&status=all|on_break|at_desk|overdue&page=&limit=
 *
 * Admin — Break History
 *   GET    /history            ?search=&department=&shiftId=&breakType=&status=&from=&to=&page=&limit=
 *                              status = all | completed | pending | approved | rejected
 *   GET    /approvals          breaks waiting for the reporting manager
 *   POST   /:id/review         { decision: "approve" | "reject", remarks? }
 *
 * Admin — Break Policy (employee sees published ones only, max 2)
 *   GET    /policies
 *   POST   /policies           unpublished until publish
 *   PUT    /policies/:id
 *   PATCH  /policies/:id/publish
 *   DELETE /policies/:id
 *
 * Scope: Super Admin / Admin = all · HR = assigned companies · Manager = team.
 */
const express = require("express");
const {
  myBreak,
  startBreak,
  endMyBreak,
  liveBreaks,
  breakHistory,
  pendingBreaks,
  reviewBreak,
  listPolicies,
  createPolicy,
  updatePolicy,
  publishPolicy,
  deletePolicy,
} = require("../controllers/break.controller");
const { protect, hasAllAccess } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { hasGlobalCompanyAccess } = require("../utils/companyScope");
const { normalizeRoleName, EMPLOYEE } = require("../config/roles");
const { validate, validateQuery } = require("../middleware/validate");
const {
  startSchema,
  liveQuerySchema,
  historyQuerySchema,
  reviewSchema,
  policySchema,
  policyUpdateSchema,
  publishSchema,
} = require("../validators/break.validation");

const router = express.Router();

const employeeSide = (user) => {
  const role = normalizeRoleName(user?.role);
  if (role === EMPLOYEE) return true;
  return user?.essAccess === true && user?.adminAccess !== true;
};

const needBreak = (subModule, action) => (req, res, next) => {
  if (employeeSide(req.user)) {
    return res.status(403).json({ message: "Employees can only start and end their own break" });
  }
  if (hasAllAccess(req.user) || hasGlobalCompanyAccess(req.user)) return next();
  return checkPermission("Break", subModule, action)(req, res, next);
};

/**
 * @swagger
 * tags:
 *   - name: Break
 *     description: Employee start/end. Admin live board and history.
 * /api/break/me:
 *   get:
 *     tags: [Break]
 *     summary: My break today (Start / End button)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: punchedIn, canStart, canEnd, open break }
 * /api/break/start:
 *   post:
 *     tags: [Break]
 *     summary: Start my break
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [breakType]
 *             properties:
 *               breakType:
 *                 type: string
 *                 enum: [Lunch Break, Day Break]
 *     responses:
 *       201: { description: Break started }
 *       400: { description: Not punched in, already on break, or daily limit }
 * /api/break/end:
 *   post:
 *     tags: [Break]
 *     summary: End my open break
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Completed or Exceeded }
 * /api/break/live:
 *   get:
 *     tags: [Break]
 *     summary: Live Break Status
 *     description: Punched-in employees. Counts are All, On Break, At Desk, Overdue.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *       - in: query
 *         name: shiftId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [all, on_break, at_desk, overdue] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: counts + page of rows }
 * /api/break/history:
 *   get:
 *     tags: [Break]
 *     summary: Break History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *       - in: query
 *         name: breakType
 *         schema: { type: string, enum: [Tea Break, Lunch Break, Short Break] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [all, completed, exceeded] }
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-08-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-08-31" }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Completed or Exceeded }
 */
router.get("/me", protect, myBreak);
router.post("/start", protect, validate(startSchema), startBreak);
router.post("/end", protect, endMyBreak);

router.get(
  "/live",
  protect,
  needBreak("Live Break Status", "view"),
  validateQuery(liveQuerySchema),
  liveBreaks
);
router.get(
  "/history",
  protect,
  needBreak("Break History", "view"),
  validateQuery(historyQuerySchema),
  breakHistory
);
router.get("/policies", protect, needBreak("Break Policy", "view"), listPolicies);
router.post(
  "/policies",
  protect,
  needBreak("Break Policy", "create"),
  validate(policySchema),
  createPolicy
);
router.put(
  "/policies/:id",
  protect,
  needBreak("Break Policy", "edit"),
  validate(policyUpdateSchema),
  updatePolicy
);
router.patch(
  "/policies/:id/publish",
  protect,
  needBreak("Break Policy", "edit"),
  validate(publishSchema),
  publishPolicy
);
router.delete("/policies/:id", protect, needBreak("Break Policy", "delete"), deletePolicy);

router.get(
  "/approvals",
  protect,
  needBreak("Break History", "view"),
  validateQuery(historyQuerySchema),
  pendingBreaks
);
router.post(
  "/:id/review",
  protect,
  needBreak("Live Break Status", "edit"),
  validate(reviewSchema),
  reviewBreak
);

module.exports = router;
