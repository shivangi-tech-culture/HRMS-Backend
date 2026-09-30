/**
 * OVERTIME / COMP-OFF REQUEST — Attendance → Overtime UI
 */
const mongoose = require("mongoose");

const OT_TYPES = ["Overtime Pay", "Comp Off"];
const OT_STATUSES = [
  "Pending",
  "Approved",
  "Rejected",
  "Comp Off Credited",
];

const overtimeSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Calendar day YYYY-MM-DD */
    date: { type: String, required: true },
    /** Requested OT duration in minutes */
    otMinutes: { type: Number, default: 0 },
    type: {
      type: String,
      enum: OT_TYPES,
      default: "Overtime Pay",
    },
    reason: { type: String, default: "" },
    status: {
      type: String,
      enum: OT_STATUSES,
      default: "Pending",
    },
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      default: null,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
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

overtimeSchema.index({ employee: 1, date: 1 });
overtimeSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model("Overtime", overtimeSchema);
module.exports.OT_TYPES = OT_TYPES;
module.exports.OT_STATUSES = OT_STATUSES;
