/**
 * ATTENDANCE MODEL
 * One Mongo document = one employee + one calendar day (unique).
 *
 * Used ONLY by attendance APIs (punch, daily, calendar).
 * Does NOT change company / employee / branch / shift assignment on User.
 * companyId / branchId / shift here are SNAPSHOTS at punch time for filters.
 */
const mongoose = require("mongoose");
const { todayDate } = require("../utils/shiftTiming");

/** Allowed punch sources */
const PUNCH_SOURCES = ["web", "mobile", "biometric", "manual", "regularization"];

/** Day status after punch-out / admin review */
const DAY_STATUSES = [
  "Pending", // punched in on time, open day
  "Late", // late punch-in — needs approve → Present / reject → Absent
  "Present",
  "Absent",
  "HalfDay",
  "WeeklyOff",
  "Holiday",
  "MissedPunch",
  "OnLeave",
  "WFH",
  "Working", // display-only for open on-time punch; may also be stored
  "Rejected", // display when a regularization request was rejected; day stays absent
];

/** Punch-in timing, then late review. Early · On time · Late · Approved · Rejected */
const ATTENDANCE_STATUSES = ["Early", "On time", "Late", "Approved", "Rejected"];

const breakSchema = new mongoose.Schema(
  {
    start: { type: Date, default: null },
    end: { type: Date, default: null },
  },
  { _id: false }
);

/** GPS from client; address filled by Map API (geocode util) */
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
    /** Who punched (User _id) — does not edit that User */
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /** Calendar day YYYY-MM-DD (app timezone) */
    date: { type: String, default: todayDate },

    /**
     * Snapshot of shift master _id at punch time (for list filters).
     * NOT writing back to User.official.shiftId.
     */
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    /**
     * Snapshots of company / branch at punch time.
     * Only stored on Attendance — User assignment stays unchanged.
     */
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    punchIn: { type: Date, default: null },
    punchOut: { type: Date, default: null },
    punchInSource: { type: String, enum: [...PUNCH_SOURCES, null], default: null },
    punchOutSource: { type: String, enum: [...PUNCH_SOURCES, null], default: null },
    punchInLocation: { type: locationSchema, default: () => ({}) },
    punchOutLocation: { type: locationSchema, default: () => ({}) },

    status: { type: String, enum: DAY_STATUSES, default: "Absent" },
    workedMinutes: { type: Number, default: 0 },
    /** Minutes over 9-hour standard day */
    overtimeMinutes: { type: Number, default: 0 },
    lateByMinutes: { type: Number, default: 0 },
    earlyByMinutes: { type: Number, default: 0 },
    workMode: { type: String, default: "WFO" }, // WFO | WFH | Hybrid
    breaks: { type: [breakSchema], default: [] },

    /**
     * ONE note field only.
     * Punch note — body.remarks only.
     */
    remarks: { type: String, default: "" },

    /**
     * From punch-in time vs shift start.
     * Early (before start) · On time (start through grace) · Late · Approved · Rejected
     */
    attendanceStatus: {
      type: String,
      enum: [...ATTENDANCE_STATUSES, null],
      default: null,
    },
    /** Why HR / manager approved or rejected the late punch */
    reviewReason: { type: String, default: "" },
    remarkReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    remarkReviewedAt: { type: Date, default: null },

    /** Admin who used manual mark (null for self punch) */
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** Reason selected when HR marks a missed punch */
    markReason: { type: String, default: "" },
    /** Set when a regularization request is approved onto this day */
    regularizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceRegularization",
      default: null,
    },
  },
  { timestamps: true }
);

attendanceSchema.pre("save", function (next) {
  if (!this.date) this.date = todayDate();
  if (this.attendanceStatus === "Pending") this.attendanceStatus = "Late";
  next();
});

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });
attendanceSchema.index({ date: 1, companyId: 1 });
attendanceSchema.index({ date: 1, attendanceStatus: 1 });
attendanceSchema.index({ lateByMinutes: 1, date: -1 });
attendanceSchema.index({ earlyByMinutes: 1, date: -1 });
attendanceSchema.index({ employee: 1, lateByMinutes: 1, date: -1 });
attendanceSchema.index({ employee: 1, earlyByMinutes: 1, date: -1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
module.exports.PUNCH_SOURCES = PUNCH_SOURCES;
module.exports.DAY_STATUSES = DAY_STATUSES;
module.exports.ATTENDANCE_STATUSES = ATTENDANCE_STATUSES;
module.exports.todayDate = todayDate;
