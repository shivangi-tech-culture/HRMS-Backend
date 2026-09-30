/**
 * SHIFT MASTER — Work → Shift Management
 *
 * UI fields: code, name, punchStart, start, end, durations, break, night, Active
 * Punch uses: punchStartTime, startTime, endTime, graceMinutes, halfDay*, allow*
 * Weekly Off is NOT chosen here — Assign Shift pe WeeklyOff policy id
 */
const mongoose = require("mongoose");

/** Validate "HH:mm" 24h times */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const shiftSchema = new mongoose.Schema(
  {
    /** Short code e.g. FIRST */
    code: { type: String, default: "" },
    /** Display name e.g. First Shift */
    name: { type: String, default: "" },
    /** Company name/scope for this shift */
    company: { type: String, default: "" },

    /** Earliest allowed punch-in (gate opens) e.g. 08:00 */
    punchStartTime: { type: String, default: "08:00" },
    /** Official duty start — late counted from here (+ grace) */
    startTime: { type: String, default: "10:00" },
    /** Official duty end — early leave / late out vs this */
    endTime: { type: String, default: "19:00" },

    /** Length of shift window (hrs) — often auto from start/end */
    shiftDuration: { type: Number, default: 9 },
    /** Expected work hours (hrs) — defaults to shiftDuration if omitted */
    workDuration: { type: Number, default: 9 },

    /** Break applicable flag (UI) */
    breakApplicable: { type: Boolean, default: false },
    /** Crosses midnight (night shift) */
    nightShift: { type: Boolean, default: false },
    /** Active | Inactive — inactive not used for punch */
    status: { type: String, default: "Active" },

    /** Half-day end time (e.g. Sat) when day is halfDay */
    halfDayEndTime: { type: String, default: "14:30" },
    /**
     * Grace after startTime before counting late (minutes).
     * Prefer setting on Shift UI — punch reads THIS field (not Work Timings)
     */
    graceMinutes: { type: Number, default: 0 },
    /** If false → cannot punch-in before startTime */
    allowEarlyPunchIn: { type: Boolean, default: true },
    /** If false → cannot punch-out after endTime */
    allowLatePunchOut: { type: Boolean, default: true },

    /**
     * Fallback WO days if assignment has no weeklyOffPolicy
     * 0=Sun … 6=Sat — prefer WeeklyOff policy via assignment
     */
    weeklyOffDays: { type: [Number], default: [0] },
    /** Which weekdays are half days (default Sat) */
    halfDayDays: { type: [Number], default: [6] },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

/** Unique code per company (case-insensitive) */
shiftSchema.index(
  { company: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
shiftSchema.index({ company: 1, status: 1 });

module.exports = mongoose.model("Shift", shiftSchema);
module.exports.TIME_RE = TIME_RE;
