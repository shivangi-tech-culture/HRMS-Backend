/**
 * SHIFT TIMING HELPERS — used by attendance punch / day metrics only.
 *
 * Does NOT create or change company / employee assignment.
 * Reads placement via attendancePlacement.js (attendance-only helper).
 */
const TZ = () => process.env.TZ || "Asia/Kolkata";

/** Today as YYYY-MM-DD in app timezone (default Asia/Kolkata) */
const todayDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ() });

/** Minutes from midnight for a Date in app TZ (e.g. 10:30 → 630) */
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

/** "HH:mm" → minutes from midnight (or null if bad) */
const parseHm = (hm) => {
  if (!hm || typeof hm !== "string") return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

/** Weekday number 0=Sun … 6=Sat for a YYYY-MM-DD string */
const weekdayOf = (dateStr) => {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+05:30`);
  return d.getUTCDay();
};

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * That date's row from a company shift monthlySchedule.
 * Week 1 = days 1–7, week 2 = 8–14, … week 5 = 29–31.
 */
const dayScheduleOf = (monthlySchedule, dateStr) => {
  const date = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return null;
  const weekNumber = Math.min(5, Math.ceil(date.getUTCDate() / 7));
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const weeks = Array.isArray(monthlySchedule) ? monthlySchedule : [];
  const week =
    weeks.find((w) => w.weekNumber === weekNumber) ||
    weeks.find((w) => w.weekNumber === 4) ||
    weeks[0];
  return (week?.days || []).find((d) => d.day === weekday) || null;
};

/** Minutes late vs that day's shift start + grace. 0 when on time or start is missing. */
const lateByMinutesOf = (punchAt, startTime, graceMinutes = DEFAULT_SHIFT.graceMinutes) => {
  const start = parseHm(startTime);
  if (start == null || !punchAt) return 0;
  const grace = Number(graceMinutes) || 0;
  return Math.max(0, minutesOfDay(new Date(punchAt)) - (start + grace));
};

/**
 * Fallback when employee has no company shift assigned.
 * Used only for punch window / metrics — never written to User.
 */
const DEFAULT_SHIFT = {
  _id: null,
  code: "DEFAULT",
  name: "Default Shift",
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

/** Standard full day = 9 hours → OT = worked − 9h (if positive) */
const STANDARD_WORK_MINUTES = 9 * 60;

const overtimeMinutesOf = (workedMinutes) => {
  const worked = Number(workedMinutes) || 0;
  return Math.max(0, worked - STANDARD_WORK_MINUTES);
};

const emptyPlacement = () => ({
  company: null,
  branch: null,
});

/**
 * Resolve shift + company + branch for attendance punch.
 *
 * READ-ONLY: does not update User.official / Company assignment.
 * Uses attendancePlacement (separate from employee assign APIs).
 *
 * @returns {{ assignment, shift, company, branch }}
 */
const getAssignedShift = async (employeeId, dateStr) => {
  try {
    const User = require("../models/User");
    // Attendance-only helper — NOT companyShift.attachPlacement
    const { getAttendanceDayPlacement } = require("./attendancePlacement");

    const user = await User.findById(employeeId).select("official").lean();
    const resolved = user
      ? await getAttendanceDayPlacement(user, dateStr || todayDate())
      : null;

    const day = resolved?.day;
    const placement = {
      company: resolved?.company || null,
      branch: resolved?.branch || null,
    };
    const shiftId = resolved?.shift?._id || null;

    // No workplace on the user → caller must not save a fake company/shift
    if (!placement.company || !placement.branch || !shiftId) {
      return {
        assignment: null,
        shift: { ...DEFAULT_SHIFT },
        ...emptyPlacement(),
      };
    }

    const shiftName = resolved.shift?.name || DEFAULT_SHIFT.name;
    const shiftCode = resolved.shift?.code || DEFAULT_SHIFT.code;

    // Shift is assigned but today's row is missing → keep company/branch/shift, default hours
    if (!day) {
      return {
        assignment: { source: "company" },
        ...placement,
        shift: {
          ...DEFAULT_SHIFT,
          _id: shiftId,
          name: shiftName,
          code: shiftCode,
          isDefault: false,
        },
      };
    }

    const weekday = weekdayOf(dateStr || todayDate());

    // Weekly off day on company schedule
    if (day.isOff) {
      return {
        assignment: { source: "company" },
        ...placement,
        shift: {
          ...DEFAULT_SHIFT,
          _id: shiftId,
          name: shiftName,
          code: shiftCode,
          weeklyOffDays: [weekday],
          halfDayDays: [],
          isDefault: false,
        },
      };
    }

    // Working day — copy start/end from company day row
    const start = parseHm(day.startTime);
    const end = parseHm(day.endTime);
    // Treat ≤ 5h window as half-day for that weekday
    const half = start != null && end != null && end - start <= 5 * 60;

    return {
      assignment: { source: "company" },
      ...placement,
      shift: {
        ...DEFAULT_SHIFT,
        _id: shiftId,
        name: shiftName,
        code: shiftCode,
        startTime: day.startTime || DEFAULT_SHIFT.startTime,
        endTime: day.endTime || DEFAULT_SHIFT.endTime,
        halfDayEndTime: day.endTime || DEFAULT_SHIFT.halfDayEndTime,
        weeklyOffDays: [],
        halfDayDays: half ? [weekday] : [],
        isDefault: false,
      },
    };
  } catch (_err) {
    // Any DB error → safe default (punch still works)
    return {
      assignment: null,
      shift: { ...DEFAULT_SHIFT },
      ...emptyPlacement(),
    };
  }
};

/** holiday | weeklyOff | halfDay | fullDay */
const dayTypeOf = (shift, dateStr, holidayMap = {}) => {
  if (holidayMap && holidayMap[dateStr]) return "holiday";
  const day = weekdayOf(dateStr);
  const offs = shift?.weeklyOffDays || DEFAULT_SHIFT.weeklyOffDays;
  if (offs.includes(day)) return "weeklyOff";
  const halfs = shift?.halfDayDays || DEFAULT_SHIFT.halfDayDays;
  if (halfs.includes(day)) return "halfDay";
  return "fullDay";
};

const effectiveEndTime = (shift, dateStr) => {
  if (dayTypeOf(shift, dateStr) === "halfDay") {
    return shift?.halfDayEndTime || "14:30";
  }
  return shift?.endTime || "19:00";
};

/**
 * Gatekeeper for punch-in / punch-out time.
 * Returns { ok, message, isEarly, isLate }.
 */
const validatePunchAgainstShift = (shift, punchAt, punchType, dateStr) => {
  if (!shift) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  const date =
    dateStr ||
    new Date(punchAt).toLocaleDateString("en-CA", { timeZone: TZ() });
  const type = dayTypeOf(shift, date);
  const punchMin = minutesOfDay(punchAt);
  const start = parseHm(shift.startTime);
  const end = parseHm(effectiveEndTime(shift, date));
  if (start == null || end == null) {
    return { ok: true, message: null, isEarly: false, isLate: false };
  }

  if (punchType === "in") {
    const punchStart = parseHm(shift.punchStartTime || "00:00") ?? 0;
    if (punchMin < punchStart && shift.allowEarlyPunchIn === false) {
      return {
        ok: false,
        message: `Punch-in not allowed before ${shift.punchStartTime || "00:00"}`,
        isEarly: true,
        isLate: false,
        dayType: type,
      };
    }
    const grace = Number(shift.graceMinutes) || 0;
    const lateByMinutes = Math.max(0, punchMin - (start + grace));
    return {
      ok: true,
      message: null,
      isEarly: punchMin < start,
      isLate: lateByMinutes > 0,
      lateByMinutes,
      dayType: type,
    };
  }

  // Punch-out: always allowed; late/early flags for metrics
  return {
    ok: true,
    message: null,
    isEarly: punchMin < end,
    isLate: punchMin > end,
    dayType: type,
  };
};

/** "14:30" style clock for UI */
const formatPunchStamp = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-GB", {
    timeZone: TZ(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** Minutes → "H:MM" */
const formatHours = (mins) => {
  if (!Number.isFinite(mins) || mins <= 0) return "0:00";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
};

/**
 * After punch-out: Present / HalfDay / Absent + late / early / OT.
 * Status values match Attendance.DAY_STATUSES (no spaces).
 */
const computeDayMetrics = (record, shift, dateStr, holidayMap = {}) => {
  const shiftObj = shift || DEFAULT_SHIFT;
  const date = dateStr || record?.date || todayDate();

  if (holidayMap[date]) {
    return {
      statusCode: "HO",
      status: "Holiday",
      workedMinutes: 0,
      overtimeMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      isLate: false,
      isEarlyExit: false,
    };
  }

  const type = dayTypeOf(shiftObj, date);
  if (type === "weeklyOff") {
    return {
      statusCode: "WO",
      status: "WeeklyOff",
      workedMinutes: 0,
      overtimeMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      isLate: false,
      isEarlyExit: false,
    };
  }

  // Incomplete punches → Absent (until both in + out)
  if (!record?.punchIn || !record?.punchOut) {
    return {
      statusCode: "A",
      status: "Absent",
      workedMinutes: 0,
      overtimeMinutes: 0,
      lateByMinutes: 0,
      earlyByMinutes: 0,
      isLate: false,
      isEarlyExit: false,
    };
  }

  const start = parseHm(shiftObj.startTime) ?? 600;
  const end = parseHm(effectiveEndTime(shiftObj, date)) ?? 1140;
  const grace = Number(shiftObj.graceMinutes) || 0;
  const inMin = minutesOfDay(record.punchIn);
  const outMin = minutesOfDay(record.punchOut);
  const workedMinutes = Math.max(0, outMin - inMin);
  const lateByMinutes = Math.max(0, inMin - (start + grace));
  const earlyByMinutes = Math.max(0, end - outMin);
  const isHalf = type === "halfDay";
  const overtimeMinutes = overtimeMinutesOf(workedMinutes);

  return {
    statusCode: isHalf ? "HD" : "P",
    status: isHalf ? "HalfDay" : "Present",
    workedMinutes,
    overtimeMinutes,
    lateByMinutes,
    earlyByMinutes,
    isLate: lateByMinutes > 0,
    isEarlyExit: earlyByMinutes > 0,
  };
};

/** @deprecated old Shift master removed — kept so old imports don't crash */
const getShiftById = async () => null;

module.exports = {
  TZ,
  todayDate,
  minutesOfDay,
  parseHm,
  weekdayOf,
  dayScheduleOf,
  lateByMinutesOf,
  dayTypeOf,
  effectiveEndTime,
  DEFAULT_SHIFT,
  STANDARD_WORK_MINUTES,
  overtimeMinutesOf,
  getAssignedShift,
  validatePunchAgainstShift,
  computeDayMetrics,
  formatHours,
  formatPunchStamp,
  getShiftById,
};
