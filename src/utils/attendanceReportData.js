/**
 * Build attendance report row data from Attendance + User
 */
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const {
  companyFilter,
  hasGlobalCompanyAccess,
  DEFAULT_COMPANY,
} = require("./companyScope");
const { formatDuration, formatClock } = require("./attendanceView");
const { todayDate, DEFAULT_SHIFT } = require("./shiftTiming");

const resolveRange = ({ month, from, to, date }) => {
  if (date) return { from: date, to: date, month: date.slice(0, 7) };
  if (from && to) return { from, to, month: from.slice(0, 7) };
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: `${month}-01`,
      to: `${month}-${String(last).padStart(2, "0")}`,
      month,
    };
  }
  const t = todayDate();
  const mon = t.slice(0, 7);
  return resolveRange({ month: mon });
};

const employeeScopeFilter = async (user) => {
  const filter = { role: "Employee", status: "Active" };
  if (!hasGlobalCompanyAccess(user)) {
    const scope = companyFilter(user);
    if (scope === false) return { error: "Your profile has no company" };
    if (scope) Object.assign(filter, scope);
  }
  return { filter };
};

const companyLabel = (user) =>
  Array.isArray(user?.official?.companyIds) && user.official.companyIds.length
    ? DEFAULT_COMPANY
    : DEFAULT_COMPANY;

/**
 * Monthly summary — one row per employee
 */
const buildMonthlySummary = async (user, range) => {
  const scope = await employeeScopeFilter(user);
  if (scope.error) return { error: scope.error };

  const employees = await User.find(scope.filter)
    .select("name official.employeeCode official.department official.companyIds")
    .sort({ name: 1 })
    .lean();

  const ids = employees.map((e) => e._id);
  const records = await Attendance.find({
    employee: { $in: ids },
    date: { $gte: range.from, $lte: range.to },
  }).lean();

  const byEmp = {};
  for (const r of records) {
    const k = String(r.employee);
    if (!byEmp[k]) byEmp[k] = [];
    byEmp[k].push(r);
  }

  const rows = employees.map((e) => {
    const list = byEmp[String(e._id)] || [];
    const present = list.filter((r) => r.status === "Present" || r.status === "HalfDay").length;
    const halfDay = list.filter((r) => r.status === "HalfDay").length;
    const absent = list.filter((r) => r.status === "Absent").length;
    const late = list.filter((r) => Number(r.lateByMinutes) > 0).length;
    const onLeave = list.filter((r) => r.status === "OnLeave").length;
    const wfh = list.filter((r) => r.status === "WFH").length;
    return {
      employeeName: e.name,
      employeeCode: e.official?.employeeCode || "",
      department: e.official?.department || "",
      present,
      halfDay,
      absent,
      late,
      onLeave,
      wfh,
      punchDays: list.length,
    };
  });

  return {
    title: "Monthly Attendance Summary",
    columns: [
      { header: "Employee", key: "employeeName", width: 24 },
      { header: "Employee ID", key: "employeeCode", width: 14 },
      { header: "Department", key: "department", width: 18 },
      { header: "Present", key: "present", width: 10 },
      { header: "Half Day", key: "halfDay", width: 10 },
      { header: "Absent", key: "absent", width: 10 },
      { header: "Late", key: "late", width: 10 },
      { header: "On Leave", key: "onLeave", width: 10 },
      { header: "WFH", key: "wfh", width: 10 },
      { header: "Punch Days", key: "punchDays", width: 12 },
    ],
    rows,
  };
};

/** Daily punch register */
const buildDailyPunch = async (user, range) => {
  const scope = await employeeScopeFilter(user);
  if (scope.error) return { error: scope.error };

  const employees = await User.find(scope.filter).select("_id").lean();
  const ids = employees.map((e) => e._id);

  const records = await Attendance.find({
    employee: { $in: ids },
    date: { $gte: range.from, $lte: range.to },
  })
    .populate(
      "employee",
      "name official.employeeCode official.department"
    )
    .sort({ date: 1, punchIn: 1 })
    .lean();

  const rows = records.map((r) => ({
    date: r.date,
    employeeName: r.employee?.name || "",
    employeeCode: r.employee?.official?.employeeCode || "",
    department: r.employee?.official?.department || "",
    shift: DEFAULT_SHIFT.name,
    punchIn: formatClock(r.punchIn, r.punchInSource) || "—",
    punchOut: formatClock(r.punchOut, r.punchOutSource) || "—",
    workingHours: formatDuration(r.workedMinutes || 0),
    status: r.status || "",
    source: r.punchInSource || r.punchOutSource || "",
  }));

  return {
    title: "Daily Punch Register",
    columns: [
      { header: "Date", key: "date", width: 12 },
      { header: "Employee", key: "employeeName", width: 22 },
      { header: "Employee ID", key: "employeeCode", width: 14 },
      { header: "Department", key: "department", width: 16 },
      { header: "Shift", key: "shift", width: 16 },
      { header: "Punch In", key: "punchIn", width: 12 },
      { header: "Punch Out", key: "punchOut", width: 12 },
      { header: "Working Hours", key: "workingHours", width: 14 },
      { header: "Status", key: "status", width: 12 },
      { header: "Source", key: "source", width: 12 },
    ],
    rows,
  };
};

/** Late & early */
const buildLateEarly = async (user, range) => {
  const scope = await employeeScopeFilter(user);
  if (scope.error) return { error: scope.error };

  const employees = await User.find(scope.filter).select("_id").lean();
  const ids = employees.map((e) => e._id);

  const records = await Attendance.find({
    employee: { $in: ids },
    date: { $gte: range.from, $lte: range.to },
    $or: [{ lateByMinutes: { $gt: 0 } }, { earlyByMinutes: { $gt: 0 } }],
  })
    .populate(
      "employee",
      "name official.employeeCode official.department"
    )
    .sort({ date: -1 })
    .lean();

  const rows = records.map((r) => ({
    date: r.date,
    employeeName: r.employee?.name || "",
    employeeCode: r.employee?.official?.employeeCode || "",
    department: r.employee?.official?.department || "",
    shift: DEFAULT_SHIFT.name,
    punchIn: formatClock(r.punchIn, r.punchInSource) || "—",
    punchOut: formatClock(r.punchOut, r.punchOutSource) || "—",
    lateBy: formatDuration(r.lateByMinutes || 0),
    earlyBy: formatDuration(r.earlyByMinutes || 0),
    flag:
      r.lateByMinutes > 0 && r.earlyByMinutes > 0
        ? "Late + Early"
        : r.lateByMinutes > 0
          ? "Late"
          : "Early Exit",
  }));

  return {
    title: "Late & Early Departures",
    columns: [
      { header: "Date", key: "date", width: 12 },
      { header: "Employee", key: "employeeName", width: 22 },
      { header: "Employee ID", key: "employeeCode", width: 14 },
      { header: "Department", key: "department", width: 16 },
      { header: "Shift", key: "shift", width: 14 },
      { header: "Punch In", key: "punchIn", width: 12 },
      { header: "Punch Out", key: "punchOut", width: 12 },
      { header: "Late By", key: "lateBy", width: 10 },
      { header: "Early By", key: "earlyBy", width: 10 },
      { header: "Flag", key: "flag", width: 14 },
    ],
    rows,
  };
};

/** Absent & missed punch */
const buildAbsentMissed = async (user, range) => {
  const scope = await employeeScopeFilter(user);
  if (scope.error) return { error: scope.error };

  const employees = await User.find(scope.filter).select("_id").lean();
  const ids = employees.map((e) => e._id);

  const records = await Attendance.find({
    employee: { $in: ids },
    date: { $gte: range.from, $lte: range.to },
    $or: [
      { status: "Absent" },
      { punchIn: { $ne: null }, punchOut: null },
    ],
  })
    .populate(
      "employee",
      "name official.employeeCode official.department"
    )
    .sort({ date: -1 })
    .lean();

  const rows = records.map((r) => ({
    date: r.date,
    employeeName: r.employee?.name || "",
    employeeCode: r.employee?.official?.employeeCode || "",
    department: r.employee?.official?.department || "",
    punchIn: formatClock(r.punchIn, r.punchInSource) || "—",
    punchOut: formatClock(r.punchOut, r.punchOutSource) || "—",
    status: r.status || "",
    issue:
      r.punchIn && !r.punchOut
        ? "Missed Punch Out"
        : r.status === "Absent"
          ? "Absent"
          : "Issue",
    reason: r.reason || "",
  }));

  return {
    title: "Absent & Missed Punch",
    columns: [
      { header: "Date", key: "date", width: 12 },
      { header: "Employee", key: "employeeName", width: 22 },
      { header: "Employee ID", key: "employeeCode", width: 14 },
      { header: "Department", key: "department", width: 16 },
      { header: "Punch In", key: "punchIn", width: 12 },
      { header: "Punch Out", key: "punchOut", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Issue", key: "issue", width: 16 },
      { header: "Reason", key: "reason", width: 24 },
    ],
    rows,
  };
};

const BUILDERS = {
  monthly_summary: buildMonthlySummary,
  daily_punch: buildDailyPunch,
  late_early: buildLateEarly,
  absent_missed: buildAbsentMissed,
};

module.exports = {
  resolveRange,
  companyLabel,
  BUILDERS,
  buildMonthlySummary,
  buildDailyPunch,
  buildLateEarly,
  buildAbsentMissed,
};
