/**
 * LEAVE APIs → /api/leave
 *
 * Employee
 *   GET  /me
 *   POST /requests
 *   POST /requests/:id/cancel
 *
 * Admin / Super Admin / HR / Reporting Manager
 *   GET/POST        /types          shared catalog, companyId not required
 *   POST            /types/defaults
 *   PATCH/DELETE    /types/:id      shared type. DELETE removes it for every company
 *   GET             /balances
 *   POST            /balances/adjust          comp off — adds days to that type's remaining
 *   GET/POST        /requests
 *   POST            /requests/:id/approve
 *   POST            /requests/:id/reject
 *   GET             /calendar?month=YYYY-MM&date=YYYY-MM-DD
 *   GET/POST        /policies       shared catalog, companyId not required
 *   PATCH/DELETE    /policies/:id   shared policy. DELETE removes it for every company
 *   GET             /history
 *
 * Scope: Super Admin / Admin = all companies · HR = assigned companies · Manager = team.
 * Leave year is April–March. Creating an employee copies active types into their wallet.
 */
const express = require("express");
const {
  listTypes,
  createType,
  seedDefaultTypes,
  updateType,
  deleteType,
  listBalances,
  adjustBalance,
  listRequests,
  applyLeave,
  approveRequest,
  rejectRequest,
  cancelRequest,
  calendar,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  history,
  myLeave,
} = require("../controllers/leave.controller");
const { protect, authorize } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const { EMPLOYEE, normalizeRoleName, ALL_ACCESS } = require("../config/roles");
const {
  typeListQuery,
  typeBody,
  typePatch,
  defaultsBody,
  balanceQuery,
  applyBody,
  reviewBody,
  adjustBody,
  requestQuery,
  calendarQuery,
  policyQuery,
  policyBody,
  policyPatch,
  historyQuery,
} = require("../validators/leave.validation");

const router = express.Router();

const admin = [protect, authorize(...ALL_ACCESS)];

const leavePerm = (name, action) => checkPermission("Leave", name, action);

const employeeOnly = (req, res, next) => {
  if (normalizeRoleName(req.user.role) !== EMPLOYEE) {
    return res.status(403).json({ message: "Employee only" });
  }
  return next();
};

/**
 * @swagger
 * tags:
 *   - name: Leave
 *     description: Leave types, balances, requests, calendar, policies, history
 */

router.get("/me", protect, employeeOnly, myLeave);

router.get("/types", ...admin, leavePerm("Leave Types", "view"), validateQuery(typeListQuery), listTypes);
router.post("/types/defaults", ...admin, leavePerm("Leave Types", "create"), validate(defaultsBody), seedDefaultTypes);
router.post("/types", ...admin, leavePerm("Leave Types", "create"), validate(typeBody), createType);
router.patch("/types/:id", ...admin, leavePerm("Leave Types", "edit"), validate(typePatch), updateType);
router.delete("/types/:id", ...admin, leavePerm("Leave Types", "delete"), deleteType);

router.get("/balances", ...admin, leavePerm("Leave Balances", "view"), validateQuery(balanceQuery), listBalances);
router.post("/balances/adjust", ...admin, leavePerm("Leave Balances", "edit"), validate(adjustBody), adjustBalance);

router.get("/requests", ...admin, leavePerm("Leave Requests", "view"), validateQuery(requestQuery), listRequests);
router.post("/requests", protect, validate(applyBody), (req, res, next) => {
  if (normalizeRoleName(req.user.role) === EMPLOYEE) return applyLeave(req, res);
  return leavePerm("Leave Requests", "create")(req, res, () => applyLeave(req, res));
});
router.post("/requests/:id/approve", ...admin, leavePerm("Leave Requests", "approve"), validate(reviewBody), approveRequest);
router.post("/requests/:id/reject", ...admin, leavePerm("Leave Requests", "reject"), validate(reviewBody), rejectRequest);
router.post("/requests/:id/cancel", protect, (req, res, next) => {
  if (normalizeRoleName(req.user.role) === EMPLOYEE) return cancelRequest(req, res);
  return leavePerm("Leave Requests", "cancel")(req, res, () => cancelRequest(req, res));
});

router.get("/calendar", ...admin, leavePerm("Leave Calendar", "view"), validateQuery(calendarQuery), calendar);

router.get("/policies", ...admin, leavePerm("Leave Policies", "view"), validateQuery(policyQuery), listPolicies);
router.post("/policies", ...admin, leavePerm("Leave Policies", "create"), validate(policyBody), createPolicy);
router.patch("/policies/:id", ...admin, leavePerm("Leave Policies", "edit"), validate(policyPatch), updatePolicy);
router.delete("/policies/:id", ...admin, leavePerm("Leave Policies", "delete"), deletePolicy);

router.get("/history", ...admin, leavePerm("Leave History", "view"), validateQuery(historyQuery), history);

module.exports = router;
