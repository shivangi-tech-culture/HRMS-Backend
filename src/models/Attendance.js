/**
 * ATTENDANCE MODEL — one punch record per employee per day
 * Unique (employee, date). Stores geo + assigned shift + day status.
 */
const mongoose = require("mongoose");
const { todayDate } = require("../utils/shiftTiming");

const PUNCH_SOURCES = ["web", "mobile", "biometric", "manual"];
const DAY_STATUSES = [
  "Pending",
  "Present",
  "Absent",
  "HalfDay",
  "WeeklyOff",
  "Holiday",
  "MissedPunch",
];

const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    address: { type: String, default: "" },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    date: { type: String, default: todayDate },
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    punchIn: { type: Date, default: null },
    punchOut: { type: Date, default: null },
    punchInSource: { type: String, default: null },
    punchOutSource: { type: String, default: null },
    punchInLocation: { type: locationSchema, default: () => ({}) },
    punchOutLocation: { type: locationSchema, default: () => ({}) },
    status: { type: String, default: "Pending" },
    workedMinutes: { type: Number, default: 0 },
    lateByMinutes: { type: Number, default: 0 },
    earlyByMinutes: { type: Number, default: 0 },
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
attendanceSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
module.exports.PUNCH_SOURCES = PUNCH_SOURCES;
module.exports.DAY_STATUSES = DAY_STATUSES;
module.exports.todayDate = todayDate;
