/**
 * ATTENDANCE REPORT — generated report instances for Reports → Attendance
 * UI: https://hrms-techculture.vercel.app/reports/attendance
 */
const mongoose = require("mongoose");

const FORMATS = ["PDF", "Excel"];

const REPORT_KEYS = [
  "monthly_summary",
  "daily_punch",
  "late_early",
  "absent_missed",
];

/** Fixed catalog matching UI table */
const REPORT_CATALOG = [
  {
    key: "monthly_summary",
    name: "Monthly Attendance Summary",
    category: "Attendance",
    defaultFormat: "PDF",
    description: "Employee-wise presents, absents, late & working days for a month",
  },
  {
    key: "daily_punch",
    name: "Daily Punch Register",
    category: "Attendance",
    defaultFormat: "Excel",
    description: "Day-wise punch in/out register",
  },
  {
    key: "late_early",
    name: "Late & Early Departures",
    category: "Attendance",
    defaultFormat: "PDF",
    description: "Late arrivals and early exits",
  },
  {
    key: "absent_missed",
    name: "Absent & Missed Punch",
    category: "Attendance",
    defaultFormat: "Excel",
    description: "Absent days and punch-in without punch-out",
  },
];

const attendanceReportSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, default: "" },
    category: { type: String, default: "Attendance" },
    format: { type: String, default: "Excel" }, // PDF | Excel
    company: { type: String, default: "" },
    from: { type: String, default: "" }, // YYYY-MM-DD
    to: { type: String, default: "" },
    month: { type: String, default: "" }, // YYYY-MM
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },
    rowCount: { type: Number, default: 0 },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    generatedAt: { type: Date, default: Date.now },
    status: { type: String, default: "Ready" }, // Ready | Failed
  },
  { timestamps: true }
);

attendanceReportSchema.index({ key: 1, company: 1, generatedAt: -1 });
attendanceReportSchema.index({ format: 1 });

module.exports = mongoose.model("AttendanceReport", attendanceReportSchema);
module.exports.REPORT_CATALOG = REPORT_CATALOG;
module.exports.REPORT_KEYS = REPORT_KEYS;
module.exports.FORMATS = FORMATS;
