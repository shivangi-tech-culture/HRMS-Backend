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
  const hourRaw = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
};

/** "3:30 PM" / "15:30" / "03:30" → 24-hour "HH:mm". 15:30 stays 15:30. 03:30 stays 03:30. */
const normalizeHm = (value) => {
  const raw = String(value || "").trim();
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    const ap = ampm[3].toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return "";
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return "";
  const h = Number(hm[1]);
  const m = Number(hm[2]);
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** "HH:mm" → minutes from midnight (or null if bad). 24-hour only. */
const parseHm = (hm) => {
  const norm = normalizeHm(hm);
  if (!norm) return null;
  const [h, m] = norm.split(":").map(Number);
  return h * 60 + m;
};

/** Pad a schedule day to 24-hour HH:mm. Does not move 03:30 to 15:30. */
const normalizeDayClock = (day) => {
  if (!day) return day;
  return {
    ...day,
    startTime: normalizeHm(day.startTime),
    endTime: normalizeHm(day.endTime),
    breakStartTime: normalizeHm(day.breakStartTime),
    breakEndTime: normalizeHm(day.breakEndTime),
  };
};

/** 24-hour start/end for punch comparison. No AM/PM guess. */
const sameDayClock = (startTime, endTime) => ({
  startTime: normalizeHm(startTime),
  endTime: normalizeHm(endTime),
});

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

/** Missing grace stays 10. An explicit 0 is kept. */
const graceMinutesOf = (value) => {
  const raw = value && typeof value === "object" ? value.graceMinutes : value;
  if (raw === undefined || raw === null || raw === "") return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
};

/**
 * Punch-in vs shift start.
 * Before start → Early.
 * Start through start+grace (10 min late is still grace) → On time, not late.
 * After grace → Late. lateByMinutes is only the minutes past grace.
 */
const punchInWindow = (punchMin, startMin, graceMinutes) => {
  const grace = graceMinutesOf(graceMinutes);
  if (punchMin == null || startMin == null) {
    return { isEarly: false, isLate: false, lateByMinutes: 0, earlyByMinutes: 0, graceMinutes: grace };
  }
  if (punchMin < startMin) {
    return {
      isEarly: true,
      isLate: false,
      lateByMinutes: 0,
      earlyByMinutes: startMin - punchMin,
      graceMinutes: grace,
    };
  }
  const afterStart = punchMin - startMin;
  if (afterStart <= grace) {
    return { isEarly: false, isLate: false, lateByMinutes: 0, earlyByMinutes: 0, graceMinutes: grace };
  }
  return {
    isEarly: false,
    isLate: true,
    lateByMinutes: afterStart - grace,
    earlyByMinutes: 0,
    graceMinutes: grace,
  };
};

/** Minutes late vs that day's shift start + grace. 0 when inside grace or start is missing. */
const lateByMinutesOf = (punchAt, startTime, graceMinutes = DEFAULT_SHIFT.graceMinutes) => {
  const start = parseHm(startTime);
  if (start == null || !punchAt) return 0;
  return punchInWindow(minutesOfDay(new Date(punchAt)), start, graceMinutes).lateByMinutes;
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

/** Minutes worked after that day's shift end. Early punch is not overtime. */
const overtimeAfterShiftEnd = (punchOut, endTime) => {
  if (!punchOut || !endTime) return 0;
  const outMin = minutesOfDay(punchOut);
  const endMin = parseHm(endTime);
  if (endMin == null) return 0;
  return Math.max(0, outMin - endMin);
};

/** Fallback when shift end is unknown: worked time over 9 hours. */
const overtimeMinutesOf = (workedMinutes, shiftMinutes) => {
  const worked = Number(workedMinutes) || 0;
  const span = Number(shiftMinutes) > 0 ? Number(shiftMinutes) : STANDARD_WORK_MINUTES;
  return Math.max(0, worked - span);
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
    const clock = sameDayClock(day.startTime, day.endTime);
    const start = parseHm(clock.startTime);
    const end = parseHm(clock.endTime);
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
        startTime: clock.startTime || DEFAULT_SHIFT.startTime,
        endTime: clock.endTime || DEFAULT_SHIFT.endTime,
        halfDayEndTime: clock.endTime || DEFAULT_SHIFT.halfDayEndTime,
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
    const window = punchInWindow(punchMin, start, shift.graceMinutes);
    return {
      ok: true,
      message: null,
      isEarly: window.isEarly,
      isLate: window.isLate,
      lateByMinutes: window.lateByMinutes,
      earlyByMinutes: window.earlyByMinutes,
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
  const stamp = new Date(date).toLocaleTimeString("en-GB", {
    timeZone: TZ(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return stamp.replace(/^24:/, "00:");
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

  // Punch in without punch out stays MissedPunch. Present only after punch out, using this shift.
  if (!record?.punchIn || !record?.punchOut) {
    const missed = Boolean(record?.punchIn);
    return {
      statusCode: missed ? "MP" : "A",
      status: missed ? "MissedPunch" : "Absent",
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
  const inMin = minutesOfDay(record.punchIn);
  const outMin = minutesOfDay(record.punchOut);
  const workedMinutes = Math.max(0, outMin - inMin);
  const lateByMinutes = punchInWindow(inMin, start, shiftObj.graceMinutes).lateByMinutes;
  const earlyByMinutes = Math.max(0, end - outMin);
  const isHalf = type === "halfDay";
  const overtimeMinutes = Math.max(0, outMin - end);

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
  graceMinutesOf,
  punchInWindow,
  parseHm,
  normalizeHm,
  sameDayClock,
  normalizeDayClock,
  weekdayOf,
  dayScheduleOf,
  lateByMinutesOf,
  dayTypeOf,
  effectiveEndTime,
  DEFAULT_SHIFT,
  STANDARD_WORK_MINUTES,
  overtimeMinutesOf,
  overtimeAfterShiftEnd,
  getAssignedShift,
  validatePunchAgainstShift,
  computeDayMetrics,
  formatHours,
  formatPunchStamp,
  getShiftById,
};
