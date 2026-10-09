/**
 * One wallet per employee per leave year (April–March).
 * Each line stores only the counters. Name, code, paid and max days stay on LeaveType.
 * remaining = maxDays + adjusted − used − pending (calculated when reading).
 */
const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },
    adjusted: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
  },
  { _id: false }
);

const adjustmentSchema = new mongoose.Schema(
  {
    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType" },
    days: { type: Number, required: true },
    reason: { type: String, default: "" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const leaveBalanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    year: { type: Number, required: true },
    items: { type: [itemSchema], default: [] },
    adjustments: { type: [adjustmentSchema], default: [] },
  },
  { timestamps: true }
);

leaveBalanceSchema.index({ employee: 1, year: 1 }, { unique: true });
leaveBalanceSchema.index({ companyId: 1, year: 1 });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);
