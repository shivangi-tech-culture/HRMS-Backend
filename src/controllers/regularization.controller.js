/**
 * Simple regularization.
 *
 * Employee
 *   GET  /api/attendance/timesheet?month=YYYY-MM
 *   POST /api/attendance/regularize          { date, punchInTime?, punchOutTime?, reason, remarks? }
 *   GET  /api/attendance/regularize
 *   POST /api/attendance/regularize/:id/cancel
 *
 * Manager / HR / Admin / Super Admin
 *   GET  /api/attendance/regularizations?status=Pending&companyId=
 *   POST /api/attendance/regularizations/:id/review?decision=approve|reject   { reason }
 *
 * Pending  → timesheet + daily show Pending
 * Approved → punches are saved, day becomes Present
 * Rejected → no punches saved, day stays Absent
 */
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const AttendanceRegularization = require("../models/AttendanceRegularization");
const User = require("../models/User");
const {
  todayDate,
  getAssignedShift,
  normalizeHm,
  minutesOfDay,
  formatPunchStamp,
} = require("../utils/shiftTiming");
const { resolveDisplayedStatus } = require("../utils/attendanceDayStatus");
const { shiftDbId, formatDurationLabel } = require("../utils/attendanceFormat");
const { userCompanyIds } = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const { normalizeRoleName, EMPLOYEE } = require("../config/roles");

const today = todayDate;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CARD = "name role status official.employeeCode official.officialEmail official.department official.companyIds official.branchId official.shiftId official.reportingHead1 official.reportingHead2";

const attendanceLists = () => require("./attendance.controller");

const clockOnDate = (dateStr, hm, label) => {
  const norm = normalizeHm(hm);
  if (!norm) return { error: `${label} must be HH:mm` };
  const at = new Date(`${dateStr}T${norm}:00+05:30`);
  if (Number.isNaN(at.getTime())) return { error: `${label} must be HH:mm` };
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
  status: row.status,
  reviewReason: row.reviewReason || "",
  reviewedAt: row.reviewedAt || null,
});

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
  const punchIn = String(body.punchInTime || "").trim()
    ? clockOnDate(date, body.punchInTime, "Punch in")
    : null;
  const punchOut = String(body.punchOutTime || "").trim()
    ? clockOnDate(date, body.punchOutTime, "Punch out")
    : null;
  if (!punchIn && !punchOut) return { error: "punchInTime or punchOutTime is required" };
  if (punchIn?.error) return punchIn;
  if (punchOut?.error) return punchOut;
  return { punchIn, punchOut };
};

/** Copy the requested times onto the attendance row and mark the day Present. */
const saveApprovedDay = async (request, actorId) => {
  const employeeId = request.employee._id || request.employee;
  const date = request.date;
  const times = readTimes(date, request);
  if (times.error) return times;

  const { shift, company, branch } = await getAssignedShift(employeeId, date);
  let record = await Attendance.findOne({ employee: employeeId, date });
  if (!record) record = new Attendance({ employee: employeeId, date });

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
    record.workedMinutes = Math.max(0, minutesOfDay(record.punchOut) - minutesOfDay(record.punchIn));
    record.status = "Present";
  } else if (record.punchIn) {
    record.status = "MissedPunch";
  }
  record.markedBy = actorId;
  record.markReason = request.reason || "";
  record.regularizationId = request._id;
  if (request.remarks) record.remarks = request.remarks;
  await record.save();
  return { record };
};

const sendList = async (res, filter, query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  if (query.status && query.status !== "ALL") filter.status = query.status;
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }
  const [total, rows] = await Promise.all([
    AttendanceRegularization.countDocuments(filter),
    AttendanceRegularization.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("employee", CARD)
      .populate("reviewedBy", "name role official.officialEmail")
      .lean(),
  ]);
  return res.json({
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    data: rows.map(toRow),
  });
};

/** GET /api/attendance/timesheet?month=YYYY-MM */
const myTimesheet = async (req, res) => {
  try {
    const askedMonth = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : "";
    const range = monthRange(askedMonth || today().slice(0, 7));
    const from = req.query.from || range.from;
    const to = req.query.to || range.to;
    const month = askedMonth || from.slice(0, 7);
    if (from > to) return res.status(400).json({ message: "from cannot be after to" });
    if (addDays(from, 61) < to) {
      return res.status(400).json({ message: "Date range cannot be longer than 62 days" });
    }

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

    const [attendance, requests] = await Promise.all([
      Attendance.find({ employee: employee._id, date: { $gte: from, $lte: to } }).lean(),
      AttendanceRegularization.find({ employee: employee._id, date: { $gte: from, $lte: to } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const attByDate = new Map(attendance.map((row) => [row.date, row]));
    const regByDate = new Map();
    for (const row of requests) if (!regByDate.has(row.date)) regByDate.set(row.date, row);

    const summary = { present: 0, absent: 0, missedPunch: 0, pending: 0, rejected: 0 };
    const data = eachDate(from, to).map((date) => {
      const att = attByDate.get(date) || null;
      const reg = regByDate.get(date) || null;
      const status =
        date > today() && !att?.punchIn
          ? ""
          : resolveDisplayedStatus({ att, reg, lateStatus: "Present" });
      if (status === "Present") summary.present += 1;
      else if (status === "MissedPunch") summary.missedPunch += 1;
      else if (status === "Pending") summary.pending += 1;
      else if (status === "Rejected") summary.rejected += 1;
      else if (status === "Absent") summary.absent += 1;
      return {
        date,
        day: WEEKDAYS[new Date(`${date}T12:00:00+05:30`).getUTCDay()],
        punchInTime: formatPunchStamp(att?.punchIn),
        punchOutTime: formatPunchStamp(att?.punchOut),
        hours: formatDurationLabel(att?.workedMinutes),
        status,
        requestStatus: reg?.status || "",
        reason: reg?.reason || "",
        remarks: reg?.remarks || att?.remarks || "",
      };
    });

    return res.json({
      employee: person(employee),
      month,
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
    const times = readTimes(date, req.body);
    if (times.error) return res.status(400).json({ message: times.error });

    const employee = await User.findById(req.user._id).select(CARD);
    if (!employee || employee.status === "Deleted") {
      return res.status(404).json({ message: "Employee not found" });
    }

    const existing = await Attendance.findOne({ employee: employee._id, date });
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

    const doc = await AttendanceRegularization.create({
      employee: employee._id,
      companyId: userCompanyIds(employee)[0] || null,
      date,
      punchInTime: times.punchIn ? times.punchIn.hm : "",
      punchOutTime: times.punchOut ? times.punchOut.hm : "",
      reason: String(req.body.reason || "").trim(),
      remarks: String(req.body.remarks || "").trim(),
      status: "Pending",
    });

    return res.status(201).json({
      message: "Request sent. It stays Pending until approved.",
      request: toRow({ ...doc.toObject(), employee }),
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
      return res.status(400).json({ message: "Invalid request id" });
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
    return res.json({ message: "Request cancelled", request: toRow(doc) });
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
      return res.status(400).json({ message: "Invalid request id" });
    }
    const decision = String(req.body.decision || "").toLowerCase();
    const reason = String(req.body.reason || "").trim();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ message: 'decision must be "approve" or "reject"' });
    }
    if (!reason) return res.status(400).json({ message: "reason is required" });

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

    if (decision === "approve") {
      const saved = await saveApprovedDay(request, req.user._id);
      if (saved.error) return res.status(400).json({ message: saved.error });
      request.status = "Approved";
    } else {
      request.status = "Rejected";
    }
    request.reviewReason = reason;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    await request.populate("reviewedBy", "name role official.officialEmail");

    return res.json({
      message: decision === "approve" ? "Approved. Day is Present." : "Rejected. Day stays Absent.",
      request: toRow(request),
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
