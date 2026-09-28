/**
 * SHIFT TIMING HELPERS — resolve assigned shift, punch windows, day status
 *
 * Rules (example shift 10:00–19:00, Sat half-day 10:00–14:30):
 * - Punch-in before 10:00 → accepted (early OK)
 * - Punch-out after end → accepted (late out OK)
 * - Saturday = working half-day (HD), not weekly off
 * - Sunday = weekly off (WO) by default
 * - Punch-in without punch-out → Absent
 */
const Shift = require("../models/Shift");

const TZ = () => process.env.TZ || "Asia/Kolkata";

/** Today as YYYY-MM-DD in app timezone */
const todayDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ() });

/** Minutes since midnight for a Date in app TZ */
const minutesOfDay = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
};

/** "HH:mm" → minutes since midnight */
const parseHm = (hm) => {
  if (!hm || typeof hm !== "string") return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

/** Weekday 0=Sun … 6=Sat in app TZ for YYYY-MM-DD */
const weekdayOf = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ(),
    weekday: "short",
  }).format(d);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? d.getUTCDay();
};

/** Day type for a date under a shift: weeklyOff | halfDay | fullDay | holiday */
const dayTypeOf = (shift, dateStr, holidayMap) => {
  if (!dateStr) return "fullDay";
  if (holidayMap && holidayMap[dateStr]) return "holiday";
  const wd = weekdayOf(dateStr);
  const weeklyOff = shift?.weeklyOffDays ?? [0];
  const halfDays = shift?.halfDayDays ?? [6];
  if (weeklyOff.includes(wd)) return "weeklyOff";
  if (halfDays.includes(wd)) return "halfDay";
  return "fullDay";
};

/** Effective end time HH:mm for that calendar day */
const effectiveEndTime = (shift, dateStr) => {
  if (!shift) return null;
  if (dayTypeOf(shift, dateStr) === "halfDay") {
    return shift.halfDayEndTime || "14:30";
  }
  return shift.endTime || "19:00";
};

/**
 * Employee shift for a date — from Shift Assignment (UI), fallback official.shift
 */
const getAssignedShift = async (employeeId, dateStr) => {
  const date = dateStr || todayDate();
  const ShiftAssignment = require("../models/ShiftAssignment");
  const assignment = await ShiftAssignment.findOne({
    employee: employeeId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
  })
    .sort({ effectiveFrom: -1 })
    .populate("shift")
    .populate("weeklyOffPolicy")
    .lean();

  if (assignment?.shift) {
    if (!assignment.shift.status || assignment.shift.status === "Active") {
      // Live WO days from Weekly Off policy (by id); fallback assignment copy
      let weeklyOffDays = assignment.shift.weeklyOffDays;
      if (assignment.weeklyOffPolicy?.offDays?.length) {
        weeklyOffDays = assignment.weeklyOffPolicy.offDays;
      } else if (assignment.weeklyOffDays?.length) {
        weeklyOffDays = assignment.weeklyOffDays;
      }
      const shift = {
        ...assignment.shift,
        weeklyOffDays,
      };
      return { assignment, shift };
    }
  }

  const User = require("../models/User");
  const user = await User.findById(employeeId)
    .select("official.shift")
    .populate("official.shift")
    .lean();
  const shift = user?.official?.shift || null;
  if (shift && (!shift.status || shift.status === "Active")) {
    return { assignment: null, shift };
  }
  return null;
};

/**
 * Validate punch against shift window for that calendar day.
 * On Saturday (half day) uses halfDayEndTime. Early in / late out accepted by default.
 */
const validatePunchAgainstShift = (shift, punchAt, punchType, dateStr) => {
  if (!shift) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  const date =
    dateStr ||
    new Date(punchAt).toLocaleDateString("en-CA", { timeZone: TZ() });
  const type = dayTypeOf(shift, date);

  if (type === "weeklyOff") {
    // Still allow punch (OT / special) — do not block
  }

  const punchMin = minutesOfDay(punchAt);
  const start = parseHm(shift.startTime);
  const end = parseHm(effectiveEndTime(shift, date));
  if (start == null || end == null) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  if (punchType === "in") {
    const punchStart = parseHm(shift.punchStartTime || "00:00");
    if (punchStart != null && punchMin < punchStart) {
      return {
        ok: false,
        message: `Punch-in before punch start time (${shift.punchStartTime}) is not allowed`,
        isEarly: true,
        isLate: false,
        dayType: type,
      };
    }
    const isEarly = punchMin < start;
    // Early (after punchStart, before shift start) — accepted by default
    if (isEarly && shift.allowEarlyPunchIn === false) {
      return {
        ok: false,
        message: `Punch-in before shift start (${shift.startTime}) is not allowed`,
        isEarly: true,
        isLate: false,
        dayType: type,
      };
    }
    return { ok: true, message: null, isEarly, isLate: false, dayType: type };
  }

  const isLate = punchMin > end;
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
  return { ok: true, message: null, isEarly: false, isLate, dayType: type };
};

/**
 * Compute attendance day status + late/early minutes from punches + shift
 */
const computeDayMetrics = (record, shift, dateStr, holidayMap) => {
  const date = dateStr || record?.date;
  const type = dayTypeOf(shift, date, holidayMap);

  if (type === "holiday" && !record?.punchIn && !record?.punchOut) {
    return {
      status: "Holiday",
      dayDesc: "Holiday",
      dayType: "holiday",
      workedMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      statusCode: "HO",
      holiday: holidayMap?.[date] || null,
    };
  }

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

  const punchIn = record?.punchIn ? new Date(record.punchIn) : null;
  const punchOut = record?.punchOut ? new Date(record.punchOut) : null;
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

  if (!punchIn && !punchOut) {
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

  let workedMinutes = 0;
  if (punchIn && punchOut) {
    workedMinutes = Math.max(
      0,
      Math.round((punchOut.getTime() - punchIn.getTime()) / 60000)
    );
  }

  let lateByMinutes = 0;
  let earlyByMinutes = 0;
  const start = shift ? parseHm(shift.startTime) : null;
  const end = shift ? parseHm(effectiveEndTime(shift, date)) : null;
  const grace = Number(shift?.graceMinutes || 0);

  if (punchIn && start != null) {
    const inMin = minutesOfDay(punchIn);
    const allowed = start + grace;
    if (inMin > allowed) lateByMinutes = inMin - start;
  }
  if (punchOut && end != null) {
    const outMin = minutesOfDay(punchOut);
    if (outMin < end) earlyByMinutes = end - outMin;
  }

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

/** Format minutes as HH:mm */
const formatHours = (minutes) => {
  const m = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

/** Format Date → "24 Aug 09:47" style in app TZ */
const formatPunchStamp = (date) => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(),
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(date))
    .replace(",", "");
};

module.exports = {
  TZ,
  todayDate,
  minutesOfDay,
  parseHm,
  weekdayOf,
  dayTypeOf,
  effectiveEndTime,
  getAssignedShift,
  validatePunchAgainstShift,
  computeDayMetrics,
  formatHours,
  formatPunchStamp,
  getShiftById: async (id) => (id ? Shift.findById(id).lean() : null),
};
