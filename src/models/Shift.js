/**
 * SHIFT MASTER — matches Work → Shift Management UI
 * Fields: code, name, punchStartTime, start/end, durations, break/night, Active
 * Employee link: User.official.shift (HR / Super Admin / Global Admin only)
 *
 * Timing rules kept:
 * - Early punch-in (after punchStartTime, before startTime) accepted
 * - Late punch-out after end accepted
 * - Sat = half day (halfDayEndTime 14:30); Sun = weekly off
 */
const mongoose = require("mongoose");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const shiftSchema = new mongoose.Schema(
  {
    /** UI: Shift Code e.g. FIRST */
    code: { type: String, default: "" },
    /** UI: Shift Name e.g. First Shift */
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    /** UI: Punch Start Time — earliest punch-in allowed (e.g. 08:00) */
    punchStartTime: { type: String, default: "08:00" },
    /** UI: Shift Start (e.g. 09:00 / 10:00) */
    startTime: { type: String, default: "10:00" },
    /** UI: Shift End (e.g. 18:00 / 19:00) */
    endTime: { type: String, default: "19:00" },
    /** UI: Shift Duration (hrs) */
    shiftDuration: { type: Number, default: 9 },
    /** UI: Work Duration (hrs) */
    workDuration: { type: Number, default: 9 },
    /** UI: Break Applicable */
    breakApplicable: { type: Boolean, default: false },
    /** UI: Night Shift */
    nightShift: { type: Boolean, default: false },
    /** UI: Active checkbox → Active | Inactive */
    status: { type: String, default: "Active" },

    // Attendance timing (kept — not all shown on Add Shift drawer)
    halfDayEndTime: { type: String, default: "14:30" },
    graceMinutes: { type: Number, default: 0 },
    allowEarlyPunchIn: { type: Boolean, default: true },
    allowLatePunchOut: { type: Boolean, default: true },
    weeklyOffDays: { type: [Number], default: [0] }, // Sunday off
    halfDayDays: { type: [Number], default: [6] }, // Saturday half day
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

shiftSchema.index(
  { company: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
shiftSchema.index({ company: 1, status: 1 });

module.exports = mongoose.model("Shift", shiftSchema);
module.exports.TIME_RE = TIME_RE;
