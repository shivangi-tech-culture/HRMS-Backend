/**
 * ATTENDANCE REGULARIZATION — employee requests fix for missed / wrong punches
 * Admin approves/rejects → updates Attendance when approved.
 */
const mongoose = require("mongoose");

const STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

const regularizationSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sheetDate: { type: String, required: true }, // YYYY-MM-DD
    /** Requested corrected times HH:mm */
    requestedInTime: { type: String, default: null },
    requestedOutTime: { type: String, default: null },
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

module.exports = mongoose.model("AttendanceRegularization", regularizationSchema);
module.exports.STATUSES = STATUSES;
