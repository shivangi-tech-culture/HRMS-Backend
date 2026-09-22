/**
 * Attendance model
 *
 * One document per employee per calendar day (YYYY-MM-DD).
 *
 * `date` is NEVER sent by the client — server always sets it to today.
 *
 * Sources (no separate verification field — use these):
 *   punchInSource  / punchOutSource
 *   web | mobile | biometric — employee
 *   manual — admin only (missed punch)
 */
const mongoose = require("mongoose");

const PUNCH_SOURCES = ["web", "mobile", "biometric", "manual"];

/** Today as YYYY-MM-DD (UTC) — used for punch records */
const todayDate = () => new Date().toISOString().slice(0, 10);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Auto: always today's date on create (not from API body)
    date: {
      type: String,
      default: todayDate,
    },

    punchIn: { type: Date, default: null },
    punchOut: { type: Date, default: null },

    punchInSource: {
      type: String,
      enum: PUNCH_SOURCES,
      default: null,
    },
    punchOutSource: {
      type: String,
      enum: PUNCH_SOURCES,
      default: null,
    },

    // Manual mark only (Mark Attendance modal)
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

attendanceSchema.pre("validate", function (next) {
  if (!this.date) {
    this.date = todayDate();
  }
  next();
});

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
module.exports.PUNCH_SOURCES = PUNCH_SOURCES;
module.exports.todayDate = todayDate;
