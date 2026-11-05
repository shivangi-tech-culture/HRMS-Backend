/**
 * Day Break pre-approval — employee requests minutes; RM / HR approve;
 * then POST /break/start can consume one Approved grant.
 */
const mongoose = require("mongoose");

const STATUSES = ["Pending", "Approved", "Rejected", "Used"];

const breakDayGrantSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    /** Calendar day YYYY-MM-DD */
    date: { type: String, required: true },
    /** Minutes the employee may take once Approved */
    minutes: { type: Number, required: true, min: 1 },
    status: { type: String, enum: STATUSES, default: "Pending" },
    reviewNote: { type: String, default: "" },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    /** BreakSession created when the grant is consumed on start */
    usedBreakId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BreakSession",
      default: null,
    },
  },
  { timestamps: true }
);

breakDayGrantSchema.index({ employee: 1, date: -1, status: 1 });
breakDayGrantSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model("BreakDayGrant", breakDayGrantSchema);
module.exports.STATUSES = STATUSES;
