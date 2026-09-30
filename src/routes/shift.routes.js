/**
 * SHIFT ROUTES → /api/shifts (+ assignments)
 */
const express = require("express");
const {
  listShifts,
  getShift,
  createShift,
  updateShift,
  deleteShift,
  assignShift,
  listAssignments,
  updateAssignment,
  deleteAssignment,
  myRoster,
} = require("../controllers/shift.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createShiftSchema,
  updateShiftSchema,
  listShiftQuerySchema,
  assignShiftSchema,
  updateAssignmentSchema,
  listAssignmentQuerySchema,
} = require("../validators/shift.validation");

const router = express.Router();

router.get(
  "/roster/me",
  protect,
  checkPermission("Self", "View Shift Roster", "view"),
  myRoster
);

router.get(
  "/assignments",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validateQuery(listAssignmentQuerySchema),
  listAssignments
);

router.post(
  "/assignments",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Assignments", "assign"),
  validate(assignShiftSchema),
  assignShift
);

router.put(
  "/assignments/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Assignments", "edit"),
  validate(updateAssignmentSchema),
  updateAssignment
);

router.delete(
  "/assignments/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Assignments", "delete"),
  deleteAssignment
);

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validateQuery(listShiftQuerySchema),
  listShifts
);

router.post(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Management", "create"),
  validate(createShiftSchema),
  createShift
);

router.get("/:id", protect, authorize(...ALL_ACCESS, "Employee"), getShift);

router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Management", "edit"),
  validate(updateShiftSchema),
  updateShift
);

router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Shift Management", "delete"),
  deleteShift
);

module.exports = router;
