/**
 * SHIFT ASSIGNMENT — Work → Shift Assignments
 * UI: Employee + Shift + Weekly Off (policy from Work → Weekly Off) + Effective From
 */
const mongoose = require("mongoose");

const shiftAssignmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    company: { type: String, default: "" },
    /** Work → Weekly Off policy (_id) — fetch by id, not Masters */
    weeklyOffPolicy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WeeklyOff",
      default: null,
    },
    /** Display: policy name or off-days label e.g. "5 Day Week" / "Sat, Sun" */
    weeklyOff: { type: String, default: "" },
    /** 0=Sun … 6=Sat — from policy.offDays (attendance / roster) */
    weeklyOffDays: { type: [Number], default: [0, 6] },
    effectiveFrom: { type: String, default: "" }, // YYYY-MM-DD
    effectiveTo: { type: String, default: null },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    remarks: { type: String, default: "" },
  },
  { timestamps: true }
);

shiftAssignmentSchema.index({ employee: 1, effectiveFrom: -1 });
shiftAssignmentSchema.index({ shift: 1 });
shiftAssignmentSchema.index({ company: 1 });
shiftAssignmentSchema.index({ weeklyOffPolicy: 1 });

module.exports = mongoose.model("ShiftAssignment", shiftAssignmentSchema);
