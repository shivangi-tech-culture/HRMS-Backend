/**
 * ATTENDANCE REPORTS ROUTES → /api/reports/attendance
 * UI: https://hrms-techculture.vercel.app/reports/attendance
 *
 * Only what the screen needs:
 *   GET  /              → table (search + format filter)
 *   POST /generate      → + Generate Report
 *   GET  /:id/download  → Download (id = lastReportId from list)
 *   POST /:id/regenerate→ Regenerate
 */
const express = require("express");
const {
  listAttendanceReports,
  generateAttendanceReport,
  downloadAttendanceReport,
  regenerateAttendanceReport,
} = require("../controllers/attendanceReport.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const Joi = require("joi");
const { REPORT_KEYS, FORMATS } = require("../models/AttendanceReport");

const router = express.Router();

const dateStr = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

const listQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(100).optional(),
  format: Joi.string()
    .valid("PDF", "Excel", "ALL", "pdf", "excel")
    .optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
}).unknown(true);

const generateSchema = Joi.object({
  // UI list uses `key`; Postman / docs use `reportKey`
  reportKey: Joi.string()
    .valid(...REPORT_KEYS)
    .optional(),
  key: Joi.string()
    .valid(...REPORT_KEYS)
    .optional(),
  format: Joi.string()
    .valid(...FORMATS, "pdf", "excel", "xlsx", "XLSX")
    .optional(),
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  date: dateStr.optional(),
})
  .or("reportKey", "key")
  .unknown(false);

router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Attendance Reports", "view"),
  validateQuery(listQuerySchema),
  listAttendanceReports
);

router.post(
  "/generate",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Attendance Reports", "export"),
  validate(generateSchema),
  generateAttendanceReport
);

router.get(
  "/:id/download",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Attendance Reports", "download"),
  downloadAttendanceReport
);

router.post(
  "/:id/regenerate",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Attendance", "Attendance Reports", "export"),
  regenerateAttendanceReport
);

module.exports = router;
