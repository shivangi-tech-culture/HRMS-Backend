/**
 * SHIFT TIMING HELPERS — resolve assigned shift, punch windows, day status
 *
 * Used by:
 * - attendance.controller.js  → punch in/out validation + day metrics
 * - timesheet.controller.js   → daily rows, worked hours, punch stamps
 * - regularization.controller.js → recompute day after regularization
 * - shift.controller.js       → calendar / day-type preview
 * - Attendance.js model       → default date = today in app TZ
 *
 * Rules (example shift 10:00–19:00, Sat half-day 10:00–14:30):
 * - Punch-in before 10:00 → accepted (early OK)
 * - Punch-out after end → accepted (late out OK)
 * - Saturday = working half-day (HD), not weekly off
 * - Sunday = weekly off (WO) by default
 * - Punch-in without punch-out → Absent
 */

// ── Models (all imports at top) ──────────────────────────────────────────────
const Shift = require("../models/Shift"); // Shift master (start/end, half-day, WO)
const ShiftAssignment = require("../models/ShiftAssignment"); // Employee ↔ shift by date range (only source for punch/timesheet)

/**
 * App timezone from env (default India).
 * Used by: todayDate, minutesOfDay, weekdayOf, formatPunchStamp, punch date strings
 */
const TZ = () => process.env.TZ || "Asia/Kolkata";

/**
 * Today as YYYY-MM-DD in app timezone.
 * Used by: getAssignedShift, Attendance model default, punch controllers, timesheet
 */
const todayDate = () =>
  // en-CA locale yields YYYY-MM-DD; honor TZ so "today" matches office calendar
  new Date().toLocaleDateString("en-CA", { timeZone: TZ() });

/**
 * Minutes since midnight for a Date in app TZ (e.g. 10:30 → 630).
 * Used by: validatePunchAgainstShift, computeDayMetrics (late/early calc)
 * @param {Date} date
 * @returns {number}
 */
const minutesOfDay = (date) => {
  // Break timestamp into hour/minute parts in app TZ (not server local)
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(), // same TZ as punch / timesheet
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // 24h so "09" not "9 AM"
  }).formatToParts(date);
  // Pick hour part from formatted parts
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  // Pick minute part from formatted parts
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  // Convert to minutes since midnight
  return hour * 60 + minute;
};

/**
 * Parse "HH:mm" string → minutes since midnight (or null if invalid).
 * Used by: validatePunchAgainstShift, computeDayMetrics, effective window checks
 * @param {string} hm
 * @returns {number|null}
 */
const parseHm = (hm) => {
  // Reject missing / non-string values
  if (!hm || typeof hm !== "string") return null;
  // Split "10:30" → [10, 30]
  const [h, m] = hm.split(":").map(Number);
  // Guard NaN / bad input
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // Hours * 60 + minutes
  return h * 60 + m;
};

/**
 * Weekday index for a YYYY-MM-DD string: 0=Sun … 6=Sat (app TZ).
 * Used by: dayTypeOf, shift.controller / timesheet day name columns
 * @param {string} dateStr
 * @returns {number}
 */
const weekdayOf = (dateStr) => {
  // Noon avoids DST edge cases when interpreting calendar date
  const d = new Date(`${dateStr}T12:00:00`);
  // Short weekday name in app TZ (Sun, Mon, …)
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ(),
    weekday: "short",
  }).format(d);
  // Map name → numeric day (matches shift.weeklyOffDays / halfDayDays)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Fallback to UTC day if format name unknown
  return map[wd] ?? d.getUTCDay();
};

/**
 * Day type under a shift: weeklyOff | halfDay | fullDay | holiday.
 * Used by: effectiveEndTime, validatePunchAgainstShift, computeDayMetrics, timesheet/shift UI
 * @param {object} shift
 * @param {string} dateStr
 * @param {object} [holidayMap] — optional map dateStr → holiday info
 * @returns {"weeklyOff"|"halfDay"|"fullDay"|"holiday"}
 */
const dayTypeOf = (shift, dateStr, holidayMap) => {
  // No date → treat as normal full day
  if (!dateStr) return "fullDay";
  // Holiday calendar wins over weekday rules
  if (holidayMap && holidayMap[dateStr]) return "holiday";
  // Resolve weekday 0–6 for that date
  const wd = weekdayOf(dateStr);
  // Default weekly off = Sunday [0]
  const weeklyOff = shift?.weeklyOffDays ?? [0];
  // Default half day = Saturday [6]
  const halfDays = shift?.halfDayDays ?? [6];
  // WO day (no work expected unless special punch)
  if (weeklyOff.includes(wd)) return "weeklyOff";
  // Half working day (shorter end time)
  if (halfDays.includes(wd)) return "halfDay";
  // Normal working day
  return "fullDay";
};

/**
 * Effective shift end "HH:mm" for that calendar day (half-day vs full).
 * Used by: validatePunchAgainstShift, computeDayMetrics, timesheet shift column
 * @param {object} shift
 * @param {string} dateStr
 * @returns {string|null}
 */
const effectiveEndTime = (shift, dateStr) => {
  // No shift configured
  if (!shift) return null;
  // Saturday (or configured half day) uses halfDayEndTime
  if (dayTypeOf(shift, dateStr) === "halfDay") {
    return shift.halfDayEndTime || "14:30"; // default half-day end
  }
  // Full day uses normal endTime
  return shift.endTime || "19:00"; // default full-day end
};

/**
 * Default when no Shift Assignment covers the date.
 * 10:00–19:00 (10 AM – 7 PM), grace 10 min.
 */
const DEFAULT_SHIFT = {
  _id: null,
  code: "DEFAULT",
  name: "Default Shift",
  punchStartTime: "00:00", // window open from midnight (no early block)
  startTime: "10:00",
  endTime: "19:00",
  halfDayEndTime: "14:30",
  graceMinutes: 10,
  allowEarlyPunchIn: true,
  allowLatePunchOut: true,
  weeklyOffDays: [0], // Sunday
  halfDayDays: [6], // Saturday
  status: "Active",
  isDefault: true,
};

/**
 * Resolve shift for punch / metrics / today API.
 *
 * Steps:
 * 1. Find ShiftAssignment covering this employee + date
 * 2. If Active shift found → return it (+ WO offDays from policy id)
 * 3. Else → return DEFAULT_SHIFT (10:00–19:00, grace 10, isDefault: true)
 *
 * @returns {Promise<{assignment: object|null, shift: object}>}
 */
const getAssignedShift = async (employeeId, dateStr) => {
  // Use given date or today
  const date = dateStr || todayDate();

  // Latest assignment that covers this date
  const assignment = await ShiftAssignment.findOne({
    employee: employeeId, // this employee
    effectiveFrom: { $lte: date }, // started on/before date
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }], // still open or ends later
  })
    .sort({ effectiveFrom: -1 }) // newest wins if overlap
    .populate("shift") // Shift master timings
    .populate("weeklyOffPolicy") // Weekly Off policy (offDays)
    .lean();

  // Valid assignment + Active shift → use it
  if (
    assignment?.shift &&
    (!assignment.shift.status || assignment.shift.status === "Active")
  ) {
    // Start with shift fallback WO days
    let weeklyOffDays = assignment.shift.weeklyOffDays ?? [0];
    // Prefer live policy offDays (id-based — no copy on assignment)
    if (assignment.weeklyOffPolicy?.offDays?.length) {
      weeklyOffDays = assignment.weeklyOffPolicy.offDays;
    }
    return {
      assignment,
      shift: { ...assignment.shift, weeklyOffDays },
    };
  }

  // No covering assignment → default timings (always a shift object)
  return { assignment: null, shift: { ...DEFAULT_SHIFT } };
};

/**
 * Validate punch against shift window for that calendar day.
 * Half-day uses halfDayEndTime. Early in / late out accepted unless shift flags say otherwise.
 * Used by: attendance.controller punchIn / punchOut
 * @param {object} shift
 * @param {Date} punchAt
 * @param {"in"|"out"} punchType
 * @param {string} [dateStr]
 * @returns {{ok: boolean, message: string|null, isEarly: boolean, isLate: boolean, dayType?: string}}
 */
const validatePunchAgainstShift = (shift, punchAt, punchType, dateStr) => {
  // No shift → allow punch (nothing to validate)
  if (!shift) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  // Calendar date of punch (or explicit dateStr)
  const date =
    dateStr ||
    new Date(punchAt).toLocaleDateString("en-CA", { timeZone: TZ() });
  // weeklyOff | halfDay | fullDay
  const type = dayTypeOf(shift, date);

  if (type === "weeklyOff") {
    // Still allow punch (OT / special) — do not block
  }

  // Punch clock minutes in app TZ
  const punchMin = minutesOfDay(punchAt);
  // Shift start minutes
  const start = parseHm(shift.startTime);
  // Effective end (half-day aware)
  const end = parseHm(effectiveEndTime(shift, date));
  // Bad config → don’t block punches
  if (start == null || end == null) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  // ── Punch IN rules ─────────────────────────────────────────────────────────
  if (punchType === "in") {
    // Earliest allowed punch-in (default midnight)
    const punchStart = parseHm(shift.punchStartTime || "00:00");
    // Too early before punch window opens
    if (punchStart != null && punchMin < punchStart) {
      return {
        ok: false,
        message: `Punch-in before punch start time (${shift.punchStartTime}) is not allowed`,
        isEarly: true,
        isLate: false,
        dayType: type,
      };
    }
    // Before official start but after punchStart = early
    const isEarly = punchMin < start;
    // Early blocked only when allowEarlyPunchIn === false
    if (isEarly && shift.allowEarlyPunchIn === false) {
      return {
        ok: false,
        message: `Punch-in before shift start (${shift.startTime}) is not allowed`,
        isEarly: true,
        isLate: false,
        dayType: type,
      };
    }
    // Early OK by default
    return { ok: true, message: null, isEarly, isLate: false, dayType: type };
  }

  // ── Punch OUT rules ────────────────────────────────────────────────────────
  // After effective end = late out
  const isLate = punchMin > end;
  // Late out blocked only when allowLatePunchOut === false
  if (isLate && shift.allowLatePunchOut === false) {
    return {
      ok: false,
      message: `Punch-out after ${
        type === "halfDay" ? "half-day end" : "shift end"
      } (${effectiveEndTime(shift, date)}) is not allowed`,
      isEarly: false,
      isLate: true,
      dayType: type,
    };
  }
  // Late out OK by default
  return { ok: true, message: null, isEarly: false, isLate, dayType: type };
};

/**
 * Compute attendance day status + late/early/worked minutes from punches + shift.
 * Used by: attendance.controller, timesheet.controller, regularization.controller
 * @param {object} record — { punchIn, punchOut, date? }
 * @param {object} shift
 * @param {string} [dateStr]
 * @param {object} [holidayMap]
 * @returns {object} metrics (status, statusCode, workedMinutes, lateByMinutes, …)
 */
const computeDayMetrics = (record, shift, dateStr, holidayMap) => {
  // Prefer explicit date, else record.date
  const date = dateStr || record?.date;
  // Resolve day type (holiday / WO / HD / full)
  const type = dayTypeOf(shift, date, holidayMap);

  // Holiday with no punches → mark Holiday
  if (type === "holiday" && !record?.punchIn && !record?.punchOut) {
    return {
      status: "Holiday",
      dayDesc: "Holiday",
      dayType: "holiday",
      workedMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      statusCode: "HO",
      holiday: holidayMap?.[date] || null, // attach holiday meta if any
    };
  }

  // Weekly off with no punches → mark WeeklyOff
  if (type === "weeklyOff" && !record?.punchIn && !record?.punchOut) {
    return {
      status: "WeeklyOff",
      dayDesc: "WeeklyOff",
      dayType: "weeklyOff",
      workedMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      statusCode: "WO",
    };
  }

  // Normalize punch timestamps
  const punchIn = record?.punchIn ? new Date(record.punchIn) : null;
  const punchOut = record?.punchOut ? new Date(record.punchOut) : null;
  // UI day description (HalfDay vs WorkDay)
  const dayDesc = type === "halfDay" ? "HalfDay" : "WorkDay";

  // User rule: punch-in but no punch-out → Absent
  if (punchIn && !punchOut) {
    return {
      status: "Absent",
      dayDesc,
      dayType: type,
      workedMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      statusCode: "A",
      reason: "Punched in but no punch-out",
    };
  }

  // No punches at all
  if (!punchIn && !punchOut) {
    // Still WO if weekly off (defensive second path)
    if (type === "weeklyOff") {
      return {
        status: "WeeklyOff",
        dayDesc: "WeeklyOff",
        dayType: "weeklyOff",
        workedMinutes: 0,
        lateByMinutes: 0,
        earlyByMinutes: 0,
        statusCode: "WO",
      };
    }
    // Working day with no punch → Absent
    return {
      status: "Absent",
      dayDesc,
      dayType: type,
      workedMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      statusCode: "A",
    };
  }

  // Worked duration in minutes (out − in)
  let workedMinutes = 0;
  if (punchIn && punchOut) {
    workedMinutes = Math.max(
      0, // never negative
      Math.round((punchOut.getTime() - punchIn.getTime()) / 60000) // ms → minutes
    );
  }

  // Late / early leave trackers
  let lateByMinutes = 0;
  let earlyByMinutes = 0;
  // Shift start minutes (or null)
  const start = shift ? parseHm(shift.startTime) : null;
  // Effective end minutes (half-day aware)
  const end = shift ? parseHm(effectiveEndTime(shift, date)) : null;
  // Grace period after start before counting late
  const grace = Number(shift?.graceMinutes || 0);

  // Late arrival: punch-in after start + grace
  if (punchIn && start != null) {
    const inMin = minutesOfDay(punchIn); // punch-in clock minutes
    const allowed = start + grace; // last minute still on-time
    if (inMin > allowed) lateByMinutes = inMin - start; // minutes past start (not past grace)
  }
  // Early departure: punch-out before effective end
  if (punchOut && end != null) {
    const outMin = minutesOfDay(punchOut); // punch-out clock minutes
    if (outMin < end) earlyByMinutes = end - outMin; // minutes left early
  }

  // Half working day with both punches → HalfDay / HD
  if (type === "halfDay") {
    return {
      status: "HalfDay",
      dayDesc: "HalfDay",
      dayType: "halfDay",
      workedMinutes,
      lateByMinutes,
      earlyByMinutes,
      statusCode: "HD",
    };
  }

  // Full day with both punches → Present / P
  return {
    status: "Present",
    dayDesc: "WorkDay",
    dayType: "fullDay",
    workedMinutes,
    lateByMinutes,
    earlyByMinutes,
    statusCode: "P",
  };
};

/**
 * Format minutes as HH:mm (e.g. 90 → "01:30").
 * Used by: timesheet.controller workedHours column
 * @param {number} minutes
 * @returns {string}
 */
const formatHours = (minutes) => {
  // Coerce invalid → 0, never negative
  const m = Math.max(0, Number(minutes) || 0);
  // Whole hours
  const h = Math.floor(m / 60);
  // Remaining minutes
  const mm = m % 60;
  // Zero-pad to HH:mm
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

/**
 * Format Date → "24 Aug 09:47" style in app TZ.
 * Used by: timesheet.controller punch range display
 * @param {Date|string|null} date
 * @returns {string}
 */
const formatPunchStamp = (date) => {
  // Empty punch → em dash
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(), // office timezone
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // 24h clock
  })
    .format(new Date(date))
    .replace(",", ""); // drop en-GB comma between date and time
};

/**
 * Load Shift master by id (lean).
 * Used by: attendance.controller when record already has shift ref
 * @param {string|null} id
 * @returns {Promise<object|null>}
 */
const getShiftById = async (id) => (id ? Shift.findById(id).lean() : null);

// ── Public API ───────────────────────────────────────────────────────────────
module.exports = {
  TZ, // timezone helper
  todayDate, // YYYY-MM-DD today
  minutesOfDay, // Date → minutes since midnight
  parseHm, // "HH:mm" → minutes
  weekdayOf, // dateStr → 0–6
  dayTypeOf, // weeklyOff | halfDay | fullDay | holiday
  effectiveEndTime, // end time for that day
  DEFAULT_SHIFT, // 10:00–19:00 grace 10 when no assignment
  getAssignedShift, // assignment shift OR default
  validatePunchAgainstShift, // punch window check
  computeDayMetrics, // Present / Absent / HD / WO / etc.
  formatHours, // minutes → HH:mm
  formatPunchStamp, // punch Date → display string
  getShiftById, // Shift.findById lean
};
