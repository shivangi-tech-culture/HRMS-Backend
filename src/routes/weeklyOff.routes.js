/**
 * WEEKLY OFF ROUTES → /api/weekly-offs
 */
const express = require("express");
const {
  listWeeklyOffs,
  getWeeklyOff,
  createWeeklyOff,
  updateWeeklyOff,
  deleteWeeklyOff,
} = require("../controllers/weeklyOff.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createWeeklyOffSchema,
  updateWeeklyOffSchema,
  listWeeklyOffQuerySchema,
} = require("../validators/work.validation");

const router = express.Router();

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validateQuery(listWeeklyOffQuerySchema),
  listWeeklyOffs
);

router.post(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Weekly Off", "create"),
  validate(createWeeklyOffSchema),
  createWeeklyOff
);

router.get("/:id", protect, authorize(...ALL_ACCESS, "Employee"), getWeeklyOff);

router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Weekly Off", "edit"),
  validate(updateWeeklyOffSchema),
  updateWeeklyOff
);

router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Weekly Off", "delete"),
  deleteWeeklyOff
);

module.exports = router;
