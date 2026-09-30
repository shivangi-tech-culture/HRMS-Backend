/**
 * ATTENDANCE MODEL — one document = one employee + one calendar day
 *
 * Used by: punch-in/out, manual mark, timesheet, close-absent
 * Unique key: (employee, date)
 */
const mongoose = require("mongoose");
const { todayDate } = require("../utils/shiftTiming"); // YYYY-MM-DD in app TZ

/** Allowed punch source values */
const PUNCH_SOURCES = ["web", "mobile", "biometric", "manual"];

/** Day status after metrics / close-absent */
const DAY_STATUSES = [
  "Pending", // punched in, waiting for out
  "Present", // full day In+Out
  "Absent", // no complete punches / in without out
  "HalfDay", // half working day In+Out
  "WeeklyOff", // weekly off, no punch
  "Holiday", // holiday, no punch
  "MissedPunch", // reserved
];

/** Geo saved on punch (lat/long from client, address from Map API) */
const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, default: null }, // GPS lat
    longitude: { type: Number, default: null }, // GPS long
    address: { type: String, default: "" }, // reverse-geocoded text
  },
  { _id: false } // embedded, no separate id
);

const attendanceSchema = new mongoose.Schema(
  {
    /** Who punched */
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** Calendar day YYYY-MM-DD (app timezone) */
    date: { type: String, default: todayDate },
    /**
     * Shift Assignment ki Shift id (real DB ref).
     * null = used default 10–7 timings (no Shift master row)
     */
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    punchIn: { type: Date, default: null }, // when came
    punchOut: { type: Date, default: null }, // when left
    punchInSource: { type: String, default: null }, // web|mobile|biometric|manual
    punchOutSource: { type: String, default: null },
    punchInLocation: { type: locationSchema, default: () => ({}) },
    punchOutLocation: { type: locationSchema, default: () => ({}) },
    status: { type: String, default: "Pending" }, // see DAY_STATUSES
    workedMinutes: { type: Number, default: 0 }, // out − in
    lateByMinutes: { type: Number, default: 0 }, // late vs start (+ grace)
    earlyByMinutes: { type: Number, default: 0 }, // left before end
    reason: { type: String, default: "" }, // e.g. missing out / manual reason
    remarks: { type: String, default: "" }, // optional note
    /** Admin who used manual mark (null for self punch) */
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true } // createdAt, updatedAt
);

/** Ensure date always set before save */
attendanceSchema.pre("save", function (next) {
  if (!this.date) this.date = todayDate();
  next();
});

/** One row per employee per day */
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
module.exports.PUNCH_SOURCES = PUNCH_SOURCES;
module.exports.DAY_STATUSES = DAY_STATUSES;
module.exports.todayDate = todayDate;
