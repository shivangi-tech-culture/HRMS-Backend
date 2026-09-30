/**
 * ATTENDANCE REGULARIZATION — employee / admin requests fix for missed / wrong punches
 * Admin approves/rejects → updates Attendance when approved.
 *
 * UI: Attendance → Attendance Regularization → New Regularization Request
 */
const mongoose = require("mongoose");

const STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

/** Type dropdown (New Regularization Request form) */
const REG_TYPES = [
  "Missed Punch In",
  "Missed Punch Out",
  "Late Mark",
  "Early Exit",
  "Wrong Status",
];

/** Reason dropdown — fallback; live list from Master type=regularizationReason */
const REG_REASONS = [
  "Forgot to Punch",
  "Biometric Issue",
  "System Downtime",
  "Client Visit",
  "Power Outage",
  "Incorrect Shift Mapping",
  "Other",
];

const regularizationSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Attendance day YYYY-MM-DD */
    sheetDate: { type: String, required: true },
    /** Requested corrected times HH:mm */
    requestedInTime: { type: String, default: null },
    requestedOutTime: { type: String, default: null },
    /**
     * UI type: Missed Punch In | Missed Punch Out | Late Mark | Early Exit | Wrong Status
     */
    type: { type: String, default: "" },
    /** Reason dropdown value e.g. Forgot to Punch */
    reason: { type: String, default: "" },
    remarks: { type: String, default: "" },
    status: { type: String, default: "Pending" },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    submitDate: { type: Date, default: Date.now },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewRemarks: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

regularizationSchema.index({ employee: 1, sheetDate: -1 });
regularizationSchema.index({ status: 1 });
regularizationSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model("AttendanceRegularization", regularizationSchema);
module.exports.STATUSES = STATUSES;
module.exports.REG_TYPES = REG_TYPES;
module.exports.REG_REASONS = REG_REASONS;
