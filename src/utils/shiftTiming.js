/**
 * SHIFT TIMING HELPERS — punch / timesheet window
 * Uses the user's assigned company shift (branchId + shiftId).
 */
const TZ = () => process.env.TZ || "Asia/Kolkata";

const todayDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TZ() });

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

const parseHm = (hm) => {
  if (!hm || typeof hm !== "string") return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const weekdayOf = (dateStr) => {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+05:30`);
  return d.getUTCDay();
};

const DEFAULT_SHIFT = {
  code: "DEFAULT",
  name: "Default Shift",
  startTime: "10:00",
  endTime: "19:00",
  halfDayEndTime: "14:30",
  graceMinutes: 10,
  allowEarlyPunchIn: true,
  allowLatePunchOut: true,
  weeklyOffDays: [0],
  halfDayDays: [6],
  status: "Active",
  isDefault: true,
};

const getAssignedShift = async (employeeId, dateStr) => {
  try {
    const User = require("../models/User");
    const { getUserDaySchedule } = require("./companyShift");
    const user = await User.findById(employeeId).select("official").lean();
    const resolved = user
      ? await getUserDaySchedule(user, dateStr || todayDate())
      : null;
    const day = resolved?.day;
    if (!day) {
      return { assignment: null, shift: { ...DEFAULT_SHIFT } };
    }

    const weekday = weekdayOf(dateStr || todayDate());
    const shiftName = resolved.shift?.shiftName || DEFAULT_SHIFT.name;
    const shiftCode = resolved.shift?.shiftCode || DEFAULT_SHIFT.code;
    if (day.isOff) {
      return {
        assignment: { source: "company" },
        shift: {
          ...DEFAULT_SHIFT,
          name: shiftName,
          code: shiftCode,
          weeklyOffDays: [weekday],
          halfDayDays: [],
        },
      };
    }

    const start = parseHm(day.startTime);
    const end = parseHm(day.endTime);
    const half = start != null && end != null && end - start <= 5 * 60;
    return {
      assignment: { source: "company" },
      shift: {
        ...DEFAULT_SHIFT,
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
    return { assignment: null, shift: { ...DEFAULT_SHIFT } };
  }
};

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
    return {
      ok: true,
      message: null,
      isEarly: punchMin < start,
      isLate: punchMin > start + grace,
      dayType: type,
    };
  }

  return {
    ok: true,
    message: null,
    isEarly: punchMin < end,
    isLate: punchMin > end,
    dayType: type,
  };
};

const formatPunchStamp = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-GB", {
    timeZone: TZ(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatHours = (mins) => {
  if (!Number.isFinite(mins) || mins <= 0) return "0:00";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
};

const computeDayMetrics = (record, shift, dateStr, holidayMap = {}) => {
  const shiftObj = shift || DEFAULT_SHIFT;
  const date = dateStr || record?.date || todayDate();

  if (holidayMap[date]) {
    return {
      statusCode: "HO",
      status: "Holiday",
      workedMinutes: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      isLate: false,
      isEarlyExit: false,
    };
  }

  const type = dayTypeOf(shiftObj, date);
  if (type === "weeklyOff") {
    return {
      statusCode: "WO",
      status: "Weekly Off",
      workedMinutes: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      isLate: false,
      isEarlyExit: false,
    };
  }

  if (!record?.punchIn || !record?.punchOut) {
    return {
      statusCode: "A",
      status: "Absent",
      workedMinutes: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
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
  const lateMinutes = Math.max(0, inMin - (start + grace));
  const earlyExitMinutes = Math.max(0, end - outMin);
  const isHalf = type === "halfDay";

  return {
    statusCode: isHalf ? "HD" : "P",
    status: isHalf ? "Half Day" : "Present",
    workedMinutes,
    lateMinutes,
    earlyExitMinutes,
    isLate: lateMinutes > 0,
    isEarlyExit: earlyExitMinutes > 0,
  };
};

/** @deprecated Shift master removed */
const getShiftById = async () => null;

module.exports = {
  TZ,
  todayDate,
  minutesOfDay,
  parseHm,
  weekdayOf,
  dayTypeOf,
  effectiveEndTime,
  DEFAULT_SHIFT,
  getAssignedShift,
  validatePunchAgainstShift,
  computeDayMetrics,
  formatHours,
  formatPunchStamp,
  getShiftById,
};
