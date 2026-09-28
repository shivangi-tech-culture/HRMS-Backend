/**
 * ATTENDANCE MODEL — one punch record per employee per day
 * Unique (employee, date). Date is always today (server). Validation → attendance.validation.js.
 */
const mongoose = require("mongoose");

const PUNCH_SOURCES = ["web", "mobile", "biometric", "manual"];

/** Today as YYYY-MM-DD (UTC) — used as default date */
const todayDate = () => new Date().toISOString().slice(0, 10);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    date: { type: String, default: todayDate },
    punchIn: { type: Date, default: null },
    punchOut: { type: Date, default: null },
    punchInSource: { type: String, default: null },
    punchOutSource: { type: String, default: null },
    reason: { type: String, default: "" },
    remarks: { type: String, default: "" },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

attendanceSchema.pre("save", function (next) {
  if (!this.date) this.date = todayDate();
  next();
});

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
module.exports.PUNCH_SOURCES = PUNCH_SOURCES;
module.exports.todayDate = todayDate;
