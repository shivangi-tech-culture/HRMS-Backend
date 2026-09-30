/**
 * HOLIDAY ROUTES → /api/holidays
 */
const express = require("express");
const {
  listHolidays,
  getHoliday,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} = require("../controllers/holiday.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createHolidaySchema,
  updateHolidaySchema,
  listHolidayQuerySchema,
} = require("../validators/work.validation");

const router = express.Router();

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validateQuery(listHolidayQuerySchema),
  listHolidays
);

router.post(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Holiday Calendar", "create"),
  validate(createHolidaySchema),
  createHoliday
);

router.get("/:id", protect, authorize(...ALL_ACCESS, "Employee"), getHoliday);

router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Holiday Calendar", "edit"),
  validate(updateHolidaySchema),
  updateHoliday
);

router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Holiday Calendar", "delete"),
  deleteHoliday
);

module.exports = router;
