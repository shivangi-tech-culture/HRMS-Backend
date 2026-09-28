/**
 * WORK TIMING ROUTES → /api/work-timings
 */
const express = require("express");
const {
  listWorkTimings,
  getWorkTiming,
  createWorkTiming,
  updateWorkTiming,
  deleteWorkTiming,
} = require("../controllers/workTiming.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createWorkTimingSchema,
  updateWorkTimingSchema,
  listWorkTimingQuerySchema,
} = require("../validators/work.validation");

const router = express.Router();

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validateQuery(listWorkTimingQuerySchema),
  listWorkTimings
);

router.post(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Work Timings", "create"),
  validate(createWorkTimingSchema),
  createWorkTiming
);

router.get("/:id", protect, authorize(...ALL_ACCESS, "Employee"), getWorkTiming);

router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Work Timings", "edit"),
  validate(updateWorkTimingSchema),
  updateWorkTiming
);

router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Work Timings", "delete"),
  deleteWorkTiming
);

module.exports = router;
