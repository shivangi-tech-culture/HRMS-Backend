/**
 * SHIFT ASSIGNMENT — Work → Shift Assignments
 *
 * UI form (only these):
 *   Employee + Shift + Weekly Off (policy id) + Effective From
 *
 * Punch / timesheet:
 *   getAssignedShift(employee, date) → is date inside effectiveFrom…effectiveTo?
 *   Yes → use this shift + WeeklyOff.offDays (by policy id)
 *   No  → DEFAULT_SHIFT 10:00–19:00 grace 10
 *
 * Do NOT store weeklyOff name/days copies — resolve from WeeklyOff by id
 */
const mongoose = require("mongoose");

const shiftAssignmentSchema = new mongoose.Schema(
  {
    /** Which employee this assignment is for */
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Which Shift master (First / Second / …) */
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
    },
    /** Copied company for listing/filters */
    company: { type: String, default: "" },
    /**
     * Weekly Off policy id only (Work → Weekly Off).
     * Punch reads offDays via populate — no duplicate days on this doc
     */
    weeklyOffPolicy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WeeklyOff",
      default: null,
    },
    /** Assignment starts on this day (YYYY-MM-DD) */
    effectiveFrom: { type: String, default: "" },
    /**
     * Assignment ends on this day (YYYY-MM-DD).
     * null = still open (UI usually does not send Effective To)
     * New assign closes previous open row automatically
     */
    effectiveTo: { type: String, default: null },
    /** HR user who created the assignment */
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    remarks: { type: String, default: "" },
  },
  { timestamps: true }
);

/** Fast lookup: employee’s latest covering assignment */
shiftAssignmentSchema.index({ employee: 1, effectiveFrom: -1 });
shiftAssignmentSchema.index({ shift: 1 });
shiftAssignmentSchema.index({ company: 1 });
shiftAssignmentSchema.index({ weeklyOffPolicy: 1 });

module.exports = mongoose.model("ShiftAssignment", shiftAssignmentSchema);
