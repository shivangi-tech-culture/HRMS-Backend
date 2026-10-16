/**
 * Simple regularization.
 *
 * Employee
 *   GET  /api/attendance/timesheet?month=YYYY-MM
 *   POST /api/attendance/regularize          { date, punchInTime?, punchOutTime?, reason, remarks?, document? }
 *   GET  /api/attendance/regularize
 *   POST /api/attendance/regularize/:id/cancel
 *
 * Manager / HR / Admin / Super Admin
 *   GET  /api/attendance/regularizations?companyId=&status=ALL|Pending|Approved|Rejected|Cancelled
 *   POST /api/attendance/regularizations/:id/review?decision=approve|reject   { reason }
 *
 * Pending  → timesheet + daily show Pending
 * Approved → missing punches are saved, or a Late day is accepted
 * Rejected → requested punches are not saved
 *
 * No punch-out stays Missed Punch.
 * A Late day is not approved on the attendance row. The employee sends
 * POST /regularize, then Reporting Manager, HR, or Super Admin reviews it.
 */
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const AttendanceRegularization = require("../models/AttendanceRegularization");
const LeaveRequest = require("../models/LeaveRequest");
const Company = require("../models/Company");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const {
  todayDate,
  getAssignedShift,
  normalizeHm,
  minutesOfDay,
  formatPunchStamp,
  dayScheduleOf,
  sameDayClock,
  parseHm,
  punchInWindow,
  computeDayMetrics,
  countedWorkedMinutes,
  DEFAULT_SHIFT,
} = require("../utils/shiftTiming");
const { resolveDisplayedStatus } = require("../utils/attendanceDayStatus");
const { shiftDbId, formatDurationLabel } = require("../utils/attendanceFormat");
const { companyMonthOf, monthStartForUser, leaveDayUnpaid, requestDates, isHalfLeave } = require("../utils/leaveBalance");
const { userCompanyIds } = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const { normalizeRoleName, EMPLOYEE } = require("../config/roles");

const today = todayDate;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CARD = "name role status official.employeeCode official.officialEmail official.department official.companyIds official.branchId official.shiftId official.reportingHead1 official.reportingHead2";

const attendanceLists = () => require("./attendance.controller");

const clockOnDate = (dateStr, hm, label) => {
  const norm = normalizeHm(hm);
  if (!norm) return { error: `${label} must look like 9:30 AM` };
  const at = new Date(`${dateStr}T${norm}:00+05:30`);
  if (Number.isNaN(at.getTime())) return { error: `${label} must look like 9:30 AM` };
  if (at.getTime() > Date.now()) return { error: `${label} cannot be in the future` };
  return { at, hm: norm };
};

const person = (user) =>
  user && user.name
    ? {
        _id: user._id,
        name: user.name || "",
        employeeCode: user.official?.employeeCode || "",
        email: user.official?.officialEmail || "",
        department: user.official?.department || "",
      }
    : null;

const toRow = (row) => ({
  _id: row._id,
  date: row.date,
  employee: person(row.employee),
  punchInTime: row.punchInTime || "",
  punchOutTime: row.punchOutTime || "",
  reason: row.reason || "",
  remarks: row.remarks || "",
  document: row.document || "",
  status: row.status,
  reviewReason: row.reviewReason || "",
  reviewedAt: row.reviewedAt || null,
});

/** Show a punch already saved on attendance when this request did not ask to change it. */
const fillSavedPunch = (row, attendance) => {
  const out = toRow(row);
  if (!out.punchInTime && attendance?.punchIn) out.punchInTime = formatPunchStamp(attendance.punchIn);
  if (!out.punchOutTime && attendance?.punchOut) out.punchOutTime = formatPunchStamp(attendance.punchOut);
  return out;
};

const rowsWithSavedPunches = async (rows) => {
  const list = Array.isArray(rows) ? rows : [rows];
  const or = [];
  const seen = new Set();
  for (const row of list) {
    const employee = row.employee?._id || row.employee;
    if (!employee || !row.date) continue;
    const key = `${String(employee)}|${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    or.push({ employee, date: row.date });
  }
  const attendance = or.length
    ? await Attendance.find({ $or: or }).select("employee date punchIn punchOut").lean()
    : [];
  const byKey = new Map(attendance.map((a) => [`${String(a.employee)}|${a.date}`, a]));
  return list.map((row) =>
    fillSavedPunch(row, byKey.get(`${String(row.employee?._id || row.employee)}|${row.date}`))
  );
};

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

const monthRange = (month) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

const eachDate = (from, to) => {
  const dates = [];
  for (let cursor = from; cursor <= to && dates.length < 62; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const oid = (value) => {
  if (value === undefined || value === null || value === "") return "";
  return String(value._id || value).trim();
};

/** "09:30" on 2026-10-10 → "10 Oct 09:30" */
const clockLabel = (date, hm) => {
  if (!hm) return "";
  const [, month, day] = String(date).split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] || ""} ${hm}`.trim();
};

/** Minutes → "09:00". Empty day is "00:00", matching the timesheet grid. */
const workedClock = (mins) => {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const STATUS_CODE = {
  Present: "P",
  Late: "L",
  EarlyLeave: "ELE",
  Absent: "A",
  MissedPunch: "MP",
  WeeklyOff: "WO",
  Holiday: "H",
  HalfDay: "HD",
  Pending: "Pending",
  Rejected: "Rejected",
};

/**
 * Company attendance month.
 * Start day 1 → the 1st through the last day.
 * Start day 24 → the 24th of the previous month through the 23rd (labeled by the ending month).
 */
const timesheetRange = async (employee, query) => {
  const askedMonth = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month : "";
  if (query.from || query.to) {
    const month = askedMonth || (query.from || query.to || today()).slice(0, 7);
    const range = monthRange(month);
    return {
      month,
      label: monthLabel(month),
      from: query.from || range.from,
      to: query.to || range.to,
    };
  }
  const month = askedMonth || today().slice(0, 7);
  const cycle = await monthStartForUser(employee);
  const anchor =
    cycle.monthStartDay === 1
      ? `${month}-01`
      : `${month}-${String(Math.min(cycle.monthEndDay, 28)).padStart(2, "0")}`;
  const period = companyMonthOf(anchor, cycle);
  return { month, label: monthLabel(month), from: period.start, to: period.end };
};

const monthLabel = (month) => {
  const [year, m] = String(month).split("-");
  return `${(MONTHS[Number(m) - 1] || "").toUpperCase()}-${year}`;
};

const loadShiftSchedule = async (employee) => {
  const companyId = userCompanyIds(employee)[0] || null;
  const branchId = oid(employee.official?.branchId);
  const shiftId = oid(employee.official?.shiftId);
  const [company, shiftMaster] = await Promise.all([
    companyId
      ? Company.findById(companyId)
          .select("branches.branchId branches.shifts.shiftId branches.shifts.isActive branches.shifts.monthlySchedule")
          .lean()
      : null,
    shiftId ? getModel("shift").findById(shiftId).select("name code").lean() : null,
  ]);
  const branch = (company?.branches || []).find((row) => oid(row.branchId) === branchId);
  const shift = (branch?.shifts || []).find(
    (row) => oid(row.shiftId) === shiftId && row.isActive !== false
  );
  return {
    name: shiftMaster?.name || DEFAULT_SHIFT.name,
    code: shiftMaster?.code || "",
    monthlySchedule: shift?.monthlySchedule || [],
    assigned: Boolean(shift),
  };
};

const dayTiming = (schedule, date) => {
  const row = schedule.assigned ? dayScheduleOf(schedule.monthlySchedule, date) : null;
  if (!row) {
    const off = (DEFAULT_SHIFT.weeklyOffDays || []).includes(
      new Date(`${date}T12:00:00+05:30`).getUTCDay()
    );
    return { isOff: off, startTime: off ? "" : DEFAULT_SHIFT.startTime, endTime: off ? "" : DEFAULT_SHIFT.endTime };
  }
  if (row.isOff) return { isOff: true, startTime: "", endTime: "" };
  const clock = sameDayClock(row.startTime, row.endTime);
  return { isOff: false, startTime: clock.startTime || DEFAULT_SHIFT.startTime, endTime: clock.endTime || DEFAULT_SHIFT.endTime };
};

const leaveUnits = (leave) => (isHalfLeave(leave?.dayType) ? 0.5 : 1);

const leavesOnDates = (rows, from, to) => {
  const map = new Map();
  for (const leave of rows) {
    for (const item of requestDates(leave)) {
      if (item.status !== "Approved" || item.date < from || item.date > to) continue;
      if (!map.has(item.date)) map.set(item.date, { ...leave, dayType: item.dayType });
    }
  }
  return map;
};

/** Latest request per employee for one day. Daily attendance uses this. */
const loadLatestRegularization = async (employeeIds, date) => {
  const ids = (employeeIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await AttendanceRegularization.find({
    employee: { $in: ids },
    date,
    status: { $in: ["Pending", "Approved", "Rejected"] },
  })
    .select("employee status")
    .sort({ createdAt: -1 })
    .lean();
  const map = new Map();
  for (const row of rows) {
    const id = String(row.employee);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
};

const readTimes = (date, body) => {
  const inRaw = String(body.punchInTime || "").trim();
  const outRaw = String(body.punchOutTime || "").trim();
  const punchIn = inRaw ? clockOnDate(date, body.punchInTime, "Punch in") : null;
  const punchOut = outRaw ? clockOnDate(date, body.punchOutTime, "Punch out") : null;
  if (punchIn?.error) return punchIn;
  if (punchOut?.error) return punchOut;
  return { punchIn, punchOut, hasTimes: Boolean(punchIn || punchOut) };
};

const ISSUE_STATUSES = ["Late", "EarlyLeave", "HalfDay", "Absent"];

/** Both punches exist and the day still needs a regularization decision. */
const isOpenIssueDay = (record) =>
  Boolean(record?.punchIn && record?.punchOut) &&
  (ISSUE_STATUSES.includes(record.status) || record.attendanceStatus === "Late") &&
  record.attendanceStatus !== "Approved";

/** Copy requested punches, or accept an existing Late day. */
const saveApprovedDay = async (request, actorId) => {
  const employeeId = request.employee._id || request.employee;
  const date = request.date;
  const times = readTimes(date, request);
  if (times.error) return times;

  const { shift, company, branch } = await getAssignedShift(employeeId, date);
  let record = await Attendance.findOne({ employee: employeeId, date });
  if (!record) record = new Attendance({ employee: employeeId, date });

  if (!times.hasTimes && !isOpenIssueDay(record)) {
    return { error: "Enter a punch in time, a punch out time, or both" };
  }

  if (times.punchIn && !record.punchIn) {
    record.punchIn = times.punchIn.at;
    record.punchInSource = "regularization";
  }
  if (times.punchOut && !record.punchOut) {
    if (!record.punchIn) return { error: "Punch in is required before punch out" };
    record.punchOut = times.punchOut.at;
    record.punchOutSource = "regularization";
  }
  if (record.punchIn && record.punchOut && record.punchOut <= record.punchIn) {
    return { error: "Punch out must be after punch in" };
  }

  if (company?._id) record.companyId = company._id;
  if (branch?._id) record.branchId = branch._id;
  const shiftId = shiftDbId(shift);
  if (shiftId) record.shift = shiftId;

  if (record.punchIn && record.punchOut) {
    const acceptIssue = isOpenIssueDay(record) || record.attendanceStatus === "Late";
    const metrics = computeDayMetrics(record, shift, date);
    record.workedMinutes = metrics.workedMinutes;
    record.overtimeMinutes = metrics.overtimeMinutes;
    record.lateByMinutes = metrics.lateByMinutes;
    record.earlyByMinutes = metrics.earlyByMinutes;
    record.status = metrics.status;
    if (ISSUE_STATUSES.includes(metrics.status) || acceptIssue) {
      record.attendanceStatus = "Approved";
    }
  } else if (record.punchIn) {
    record.status = "MissedPunch";
  }
  record.markedBy = actorId;
  record.markReason = request.reason || "";
  record.regularizationId = request._id;
  record.remarkReviewedBy = actorId;
  record.remarkReviewedAt = new Date();
  if (request.remarks) record.remarks = request.remarks;
  await record.save();
  return { record };
};

const sendList = async (res, filter, query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }
  const status = String(query.status || "ALL");
  const listFilter = status !== "ALL" ? { ...filter, status } : filter;
  const [total, rows, grouped] = await Promise.all([
    AttendanceRegularization.countDocuments(listFilter),
    AttendanceRegularization.find(listFilter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("employee", CARD)
      .populate("reviewedBy", "name role official.officialEmail")
      .lean(),
    AttendanceRegularization.aggregate([
      { $match: filter },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
  ]);
  const summary = { all: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const row of grouped) {
    const key = String(row._id || "").toLowerCase();
    if (summary[key] !== undefined) summary[key] = row.n;
    summary.all += row.n;
  }
  return res.json({
    summary,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    data: await rowsWithSavedPunches(rows),
  });
};

/** GET /api/attendance/timesheet?month=YYYY-MM */
const myTimesheet = async (req, res) => {
  try {
    const employee = await User.findById(req.query.employeeId || req.user._id).select(CARD);
    if (!employee || employee.status === "Deleted") {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (String(employee._id) !== String(req.user._id)) {
      if (normalizeRoleName(req.user.role) === EMPLOYEE) {
        return res.status(403).json({ message: "You can only view your own timesheet" });
      }
      const scopeErr = assertTeamOrCompanyEmployee(req.user, employee);
      if (scopeErr) return res.status(403).json({ message: scopeErr });
    }

    const range = await timesheetRange(employee, req.query);
    const { month, label, from, to } = range;
    if (from > to) return res.status(400).json({ message: "From date cannot be after to date" });
    if (addDays(from, 61) < to) {
      return res.status(400).json({ message: "Date range cannot be longer than 62 days" });
    }

    const [attendance, requests, leaveRows, schedule] = await Promise.all([
      Attendance.find({ employee: employee._id, date: { $gte: from, $lte: to } }).lean(),
      AttendanceRegularization.find({ employee: employee._id, date: { $gte: from, $lte: to } })
        .sort({ createdAt: -1 })
        .lean(),
      LeaveRequest.find({
        employee: employee._id,
        status: { $in: ["Approved", "Partial"] },
        from: { $lte: to },
        to: { $gte: from },
      })
        .populate("leaveType", "name code paid")
        .lean(),
      loadShiftSchedule(employee),
    ]);
    const attByDate = new Map(attendance.map((row) => [row.date, row]));
    const regByDate = new Map();
    for (const row of requests) if (!regByDate.has(row.date)) regByDate.set(row.date, row);
    const leaveByDate = leavesOnDates(leaveRows, from, to);

    const summary = {
      present: 0,
      absent: 0,
      missedPunch: 0,
      pending: 0,
      rejected: 0,
      daySummary: { monthDays: 0, workDays: 0, weeklyOffs: 0, holidays: 0 },
      presentSummary: { presents: 0, countWeeklyOff: 0, countHoliday: 0, compensatoryOff: 0 },
      leaves: {
        lateArrivals: 0,
        leaveForLs: 0,
        lateEarlyCount: 0,
        shortLeave: 0,
        leavesForLs: 0,
        unpaidLeave: 0,
        lta: 0,
        totalLeaves: 0,
      },
      absentLate: { absents: 0, lateByMinutes: 0, earlyByMinutes: 0, lateBy: "0h 0m", earlyBy: "0h 0m" },
      payable: { salaryDays: 0, deductionDays: 0 },
    };
    let salaryDays = 0;

    const data = eachDate(from, to).map((date) => {
      const att = attByDate.get(date) || null;
      const reg = regByDate.get(date) || null;
      const leave = leaveByDate.get(date) || null;
      const timing = dayTiming(schedule, date);
      const future = date > today() && !att?.punchIn;
      const punched = Boolean(att?.punchIn);
      const closed = punched && Boolean(att?.punchOut);
      let shiftStatus = "Present";
      let workedMinutes = Number(att?.workedMinutes) || 0;
      if (closed && !timing.isOff && timing.startTime && timing.endTime) {
        const metrics = computeDayMetrics(
          att,
          {
            startTime: timing.startTime,
            endTime: timing.endTime,
            graceMinutes: DEFAULT_SHIFT.graceMinutes,
            weeklyOffDays: [],
            halfDayDays: [],
          },
          date
        );
        shiftStatus = metrics.status;
        workedMinutes = metrics.workedMinutes;
      } else if (closed) {
        const startMin = parseHm(timing.startTime);
        workedMinutes = countedWorkedMinutes(
          minutesOfDay(att.punchIn),
          minutesOfDay(att.punchOut),
          startMin
        );
      }

      let statusLabel = future
        ? ""
        : resolveDisplayedStatus({ att, reg, lateStatus: shiftStatus });

      let lateBy = 0;
      let earlyBy = 0;
      if (closed && !timing.isOff && timing.startTime) {
        const arrived = punchInWindow(
          minutesOfDay(att.punchIn),
          parseHm(timing.startTime),
          DEFAULT_SHIFT.graceMinutes
        );
        lateBy = arrived.lateByMinutes;
      }
      if (closed && !timing.isOff && timing.endTime) {
        const endMin = parseHm(timing.endTime);
        const outMin = minutesOfDay(att.punchOut);
        if (endMin != null) earlyBy = Math.max(0, endMin - outMin);
      }

      let dayDesc = timing.isOff ? "WeeklyOff" : "WorkDay";
      let shift = timing.isOff ? "Weekly Off" : schedule.name;
      if (timing.isOff && !punched) {
        statusLabel = "WeeklyOff";
      } else if (timing.isOff && closed) {
        shift = schedule.name;
        statusLabel = "Present";
      }

      const leaveCode = String(leave?.leaveType?.code || "").toUpperCase();
      const onLeave = Boolean(leave) && !punched && !future && statusLabel !== "Pending";
      if (onLeave) {
        statusLabel = leave.leaveType?.name || "On Leave";
        dayDesc = "Leave";
        shift = schedule.name;
      } else if (isHalfLeave(leave?.dayType) && (statusLabel === "Present" || statusLabel === "Late")) {
        statusLabel = "HalfDay";
      }

      const status = onLeave ? leaveCode || "L" : STATUS_CODE[statusLabel] || statusLabel;
      const units = leaveUnits(leave);

      summary.daySummary.monthDays += 1;
      if (timing.isOff && !onLeave) summary.daySummary.weeklyOffs += 1;
      else summary.daySummary.workDays += 1;

      if (status === "P" || status === "L" || status === "ELE") {
        summary.present += 1;
        summary.presentSummary.presents += 1;
        salaryDays += 1;
        if (timing.isOff) summary.presentSummary.countWeeklyOff += 1;
      } else if (status === "HD") {
        summary.present += 1;
        summary.presentSummary.presents += 0.5;
        salaryDays += 0.5;
      } else if (status === "MP") summary.missedPunch += 1;
      else if (status === "Pending") summary.pending += 1;
      else if (status === "Rejected") {
        summary.rejected += 1;
        summary.absent += 1;
      } else if (status === "A") summary.absent += 1;
      else if (status === "WO") salaryDays += 1;
      else if (onLeave) {
        summary.leaves.totalLeaves += units;
        if (isHalfLeave(leave?.dayType)) summary.leaves.shortLeave += units;
        if (leaveDayUnpaid(leave, date) || leave?.leaveType?.paid === false || leaveCode === "UL") {
          summary.leaves.unpaidLeave += units;
          summary.payable.deductionDays = Math.round(((summary.payable.deductionDays || 0) + units) * 10) / 10;
        } else salaryDays += units;
        if (leaveCode === "CO") summary.presentSummary.compensatoryOff += units;
        if (leaveCode === "LTA") summary.leaves.lta += units;
      }

      if ((status === "P" || status === "L" || status === "ELE" || status === "HD") && lateBy > 0) {
        summary.leaves.lateArrivals += 1;
        summary.absentLate.lateByMinutes += lateBy;
      }
      if ((status === "P" || status === "L" || status === "ELE" || status === "HD") && (lateBy > 0 || earlyBy > 0)) {
        summary.leaves.lateEarlyCount += 1;
      }
      if ((status === "P" || status === "L" || status === "ELE" || status === "HD") && earlyBy > 0) {
        summary.absentLate.earlyByMinutes += earlyBy;
      }

      const punchInTime = formatPunchStamp(att?.punchIn);
      const punchOutTime = formatPunchStamp(att?.punchOut);
      const inTime = clockLabel(date, punchInTime);
      const outTime = clockLabel(date, punchOutTime);
      const canApply =
        date <= today() &&
        dayDesc === "WorkDay" &&
        (status === "A" || status === "MP" || status === "L" || status === "ELE" || status === "HD" || status === "Rejected") &&
        reg?.status !== "Pending" &&
        reg?.status !== "Approved";

      return {
        date,
        day: WEEKDAYS[new Date(`${date}T12:00:00+05:30`).getUTCDay()],
        shift,
        inTime,
        outTime,
        inOut: inTime && outTime ? `${inTime} - ${outTime}` : inTime || outTime || "—",
        punchInTime,
        punchOutTime,
        workedHours: workedClock(workedMinutes),
        hours: formatDurationLabel(workedMinutes),
        status,
        statusLabel,
        dayDesc,
        canApply,
        requestStatus: reg?.status || "",
        reason: reg?.reason || "",
        remarks: reg?.remarks || att?.remarks || "",
        lateByMinutes: lateBy,
        earlyByMinutes: earlyBy,
      };
    });

    summary.absentLate.absents = summary.absent;
    summary.absentLate.lateBy = formatDurationLabel(summary.absentLate.lateByMinutes);
    summary.absentLate.earlyBy = formatDurationLabel(summary.absentLate.earlyByMinutes);
    summary.payable.salaryDays = Math.round(salaryDays * 10) / 10;
    summary.presentSummary.presents = Math.round(summary.presentSummary.presents * 10) / 10;

    return res.json({
      employee: { ...person(employee), shift: schedule.name },
      month,
      label,
      from,
      to,
      summary,
      total: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** POST /api/attendance/regularize — employee, for themselves only */
const requestRegularization = async (req, res) => {
  try {
    const date = req.body.date;
    if (date > today()) return res.status(400).json({ message: "Date cannot be in the future" });

    const employee = await User.findById(req.user._id).select(CARD);
    if (!employee || employee.status === "Deleted") {
      return res.status(404).json({ message: "Employee not found" });
    }

    const existing = await Attendance.findOne({ employee: employee._id, date });
    if (existing?.punchIn && existing?.punchOut && existing.attendanceStatus === "Approved") {
      return res.status(400).json({ message: "This late day is already approved" });
    }
    const lateDay = isOpenIssueDay(existing);

    const times = readTimes(date, req.body);
    if (times.error) return res.status(400).json({ message: times.error });
    if (!times.hasTimes && !lateDay) {
      return res.status(400).json({ message: "Enter a punch in time, a punch out time, or both" });
    }

    if (!lateDay) {
      if (times.punchIn && existing?.punchIn) {
        return res.status(400).json({ message: "Punch in is already marked for this day" });
      }
      if (times.punchOut && existing?.punchOut) {
        return res.status(400).json({ message: "Punch out is already marked for this day" });
      }
      if (times.punchOut && !existing?.punchIn && !times.punchIn) {
        return res.status(400).json({ message: "Punch in is required before punch out" });
      }
      if (existing?.punchIn && existing?.punchOut) {
        return res.status(400).json({ message: "Attendance for this day is already complete" });
      }
    }

    const doc = await AttendanceRegularization.create({
      employee: employee._id,
      companyId: userCompanyIds(employee)[0] || null,
      date,
      punchInTime: lateDay ? "" : times.punchIn ? times.punchIn.hm : "",
      punchOutTime: lateDay ? "" : times.punchOut ? times.punchOut.hm : "",
      reason: String(req.body.reason || "").trim(),
      remarks: String(req.body.remarks || "").trim(),
      document: String(req.body.document || "").trim(),
      status: "Pending",
    });

    return res.status(201).json({
      message: lateDay
        ? "Attendance request sent. Reporting Manager, HR, or Super Admin can approve it. Daily attendance updates after review."
        : "Request sent. It stays Pending until approved. Punch out is still Missed Punch until then.",
      request: (await rowsWithSavedPunches([{ ...doc.toObject(), employee }]))[0],
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ message: "A request is already pending for this date" });
    }
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/regularize — own requests */
const myRegularizations = (req, res) =>
  sendList(res, { employee: req.user._id }, req.query).catch((err) =>
    res.status(500).json({ message: err.message })
  );

/** POST /api/attendance/regularize/:id/cancel */
const cancelRegularization = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Request is not valid" });
    }
    const doc = await AttendanceRegularization.findById(req.params.id).populate("employee", CARD);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (String(doc.employee._id || doc.employee) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only cancel your own request" });
    }
    if (doc.status !== "Pending") {
      return res.status(400).json({ message: `Cannot cancel a ${doc.status} request` });
    }
    doc.status = "Cancelled";
    await doc.save();
    return res.json({
      message: "Request cancelled",
      request: (await rowsWithSavedPunches([doc]))[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/regularizations — approval list */
const listRegularizations = async (req, res) => {
  try {
    if (normalizeRoleName(req.user.role) === EMPLOYEE) {
      return res.status(403).json({ message: "Use your own regularization list" });
    }
    const { resolveListCompanyId, applyListCompany, scopedEmployeeFilter } = attendanceLists();
    const companyScope = await resolveListCompanyId(req.user, req.query.companyId);
    if (companyScope.error) {
      return res.status(companyScope.status).json({ message: companyScope.error });
    }
    const empFilter = scopedEmployeeFilter(req.user);
    applyListCompany(empFilter, companyScope);
    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const clause = {
        $or: [
          { name: rx },
          { "official.employeeCode": rx },
          { "official.officialEmail": rx },
        ],
      };
      empFilter.$and = [...(empFilter.$and || []), ...(empFilter.$or ? [{ $or: empFilter.$or }] : []), clause];
      delete empFilter.$or;
    }
    const employeeIds = await User.distinct("_id", empFilter);
    return sendList(res, { employee: { $in: employeeIds } }, req.query);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** POST /api/attendance/regularizations/:id/review?decision=approve|reject */
const reviewRegularization = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Request is not valid" });
    }
    const decision = String(req.body.decision || "").toLowerCase();
    const reason = String(req.body.reason || "").trim();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve or reject" });
    }
    if (!reason) return res.status(400).json({ message: "Reason is required" });

    const request = await AttendanceRegularization.findById(req.params.id).populate("employee", CARD);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "Pending") {
      return res.status(400).json({ message: `Already ${request.status}` });
    }
    if (String(request.employee._id) === String(req.user._id)) {
      return res.status(403).json({ message: "You cannot review your own request" });
    }
    const scopeErr = assertTeamOrCompanyEmployee(req.user, request.employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });

    let dayStatus = "";
    if (decision === "approve") {
      const saved = await saveApprovedDay(request, req.user._id);
      if (saved.error) return res.status(400).json({ message: saved.error });
      request.status = "Approved";
      dayStatus = saved.record?.status || "";
    } else {
      request.status = "Rejected";
      const record = await Attendance.findOne({
        employee: request.employee._id,
        date: request.date,
      });
      if (record && (ISSUE_STATUSES.includes(record.status) || record.attendanceStatus === "Late")) {
        record.attendanceStatus = "Rejected";
        record.reviewReason = reason;
        record.remarkReviewedBy = req.user._id;
        record.remarkReviewedAt = new Date();
        await record.save();
        dayStatus = record.status;
      } else if (record?.punchIn && !record?.punchOut) {
        dayStatus = "MissedPunch";
      }
    }
    request.reviewReason = reason;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    await request.populate("reviewedBy", "name role official.officialEmail");

    return res.json({
      message:
        decision === "approve"
          ? `Approved. Day is ${dayStatus || "updated"}.`
          : dayStatus === "MissedPunch"
            ? "Rejected. Punch out is still Missed Punch."
            : dayStatus
              ? `Rejected. Day stays ${dayStatus}.`
              : "Rejected.",
      request: (await rowsWithSavedPunches([request]))[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  myTimesheet,
  requestRegularization,
  myRegularizations,
  cancelRegularization,
  listRegularizations,
  reviewRegularization,
  loadLatestRegularization,
};
