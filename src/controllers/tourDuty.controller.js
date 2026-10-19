/**
 * On Tour / On Duty.
 *
 * Employee (Self → On Tour/On Duty Entries)
 *   POST /api/attendance/tour-duty
 *   GET  /api/attendance/tour-duty
 *   GET  /api/attendance/tour-duty/:id
 *   POST /api/attendance/tour-duty/:id/cancel
 *
 * Attendance admin (Attendance → On Tour/On Duty)
 *   GET  /api/attendance/tour-duties
 *   POST /api/attendance/tour-duties/:id/review?decision=approve|reject
 *
 * Approve sets each day to Present.
 * Reject sets each day without a punch to Absent.
 * Reporting Manager (own team), HR (assigned companies), or Super Admin reviews it.
 */
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const TourDuty = require("../models/TourDuty");
const LeaveRequest = require("../models/LeaveRequest");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const { getAssignedShift, normalizeHm, parseHm } = require("../utils/shiftTiming");
const { shiftDbId } = require("../utils/attendanceFormat");
const { userCompanyIds } = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const { normalizeRoleName, EMPLOYEE, SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER } = require("../config/roles");

const CARD =
  "name role status official.employeeCode official.officialEmail official.department official.companyIds official.branchId official.shiftId official.reportingHead1 official.reportingHead2";

const CATEGORY_MASTER = {
  "On Tour": "onTourCategory",
  "On Duty": "onDutyCategory",
};
const REVIEW_ROLES = new Set([SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER]);
const MAX_DAYS = 31;

const attendanceLists = () => require("./attendance.controller");

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

const eachDate = (from, to) => {
  const dates = [];
  for (let cursor = from; cursor <= to && dates.length <= MAX_DAYS; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
};

const inclusiveDays = (from, to) => eachDate(from, to).length;

const monthBounds = (month) => {
  const [y, m] = String(month).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
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

const categoryCard = (doc) =>
  doc && (doc._id || doc.name)
    ? { _id: doc._id || null, name: doc.name || "" }
    : null;

const toRow = (row, category) => {
  const days = inclusiveDays(row.fromDate, row.toDate);
  const stored = category || (row.tourCategory && row.tourCategory.name ? row.tourCategory : null);
  return {
    _id: row._id,
    employee: person(row.employee),
    dutyType: row.dutyType,
    tourCategory: categoryCard(stored),
    fromDate: row.fromDate,
    fromTime: row.fromTime,
    toDate: row.toDate,
    toTime: row.toTime,
    durationDays: days,
    duration: `${days} Day(s)`,
    reason: row.reason || "",
    remarks: row.remarks || "",
    document: row.document || "",
    status: row.status,
    submitDate: row.createdAt || null,
    approvedBy: person(row.reviewedBy),
    reviewReason: row.reviewReason || "",
    reviewedAt: row.reviewedAt || null,
  };
};

const applyRange = (filter, query) => {
  if (query.month) {
    const bounds = monthBounds(query.month);
    filter.fromDate = { $lte: bounds.to };
    filter.toDate = { $gte: bounds.from };
    return;
  }
  if (query.from) filter.toDate = { ...(filter.toDate || {}), $gte: query.from };
  if (query.to) filter.fromDate = { ...(filter.fromDate || {}), $lte: query.to };
};

const sendList = async (res, filter, query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  applyRange(filter, query);
  const status = String(query.status || "ALL");
  const listFilter = status !== "ALL" ? { ...filter, status } : filter;
  const [total, rows, grouped] = await Promise.all([
    TourDuty.countDocuments(listFilter),
    TourDuty.find(listFilter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("employee", CARD)
      .populate("reviewedBy", "name role official.officialEmail official.employeeCode official.department")
      .lean(),
    TourDuty.aggregate([
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
    data: await rowsWithCategory(rows),
  });
};

const categoryIdOf = (value) => {
  if (!value) return "";
  return String(value._id || value);
};

const loadCategory = async (dutyType, id) => {
  const masterType = CATEGORY_MASTER[dutyType];
  if (!masterType || !mongoose.Types.ObjectId.isValid(String(id || ""))) return null;
  return getModel(masterType).findOne({ _id: id, status: { $ne: "Inactive" } }).select("name").lean();
};

const rowsWithCategory = async (rows) => {
  const buckets = { "On Tour": new Set(), "On Duty": new Set() };
  for (const row of rows) {
    const id = categoryIdOf(row.tourCategory);
    if (id && buckets[row.dutyType]) buckets[row.dutyType].add(id);
  }
  const maps = { "On Tour": new Map(), "On Duty": new Map() };
  await Promise.all(
    Object.entries(buckets).map(async ([dutyType, ids]) => {
      const list = [...ids];
      if (!list.length) return;
      const found = await getModel(CATEGORY_MASTER[dutyType])
        .find({ _id: { $in: list } })
        .select("name")
        .lean();
      for (const item of found) maps[dutyType].set(String(item._id), item);
    })
  );
  return rows.map((row) => toRow(row, maps[row.dutyType]?.get(categoryIdOf(row.tourCategory)) || null));
};

const rowWithCategory = async (row) => {
  const category = await loadCategory(row.dutyType, categoryIdOf(row.tourCategory));
  return toRow(row, category);
};

const leaveConflict = async (employeeId, fromDate, toDate) => {
  const leaves = await LeaveRequest.find({
    employee: employeeId,
    status: { $in: ["Pending", "Approved", "Partial"] },
    from: { $lte: toDate },
    to: { $gte: fromDate },
  })
    .select("status dates")
    .lean();
  for (const leave of leaves) {
    if (leave.status === "Pending" || leave.status === "Approved") return true;
    const hit = (leave.dates || []).some(
      (day) => day.status === "Approved" && day.date >= fromDate && day.date <= toDate
    );
    if (hit) return true;
  }
  return false;
};

const overlapConflict = async (employeeId, fromDate, toDate) => {
  const row = await TourDuty.findOne({
    employee: employeeId,
    status: { $in: ["Pending", "Approved"] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  })
    .select("_id")
    .lean();
  return Boolean(row);
};

/** Approved days are Present. The request id stays on onTourId or onDutyId. */
const saveApprovedDays = async (request, actorId) => {
  const employeeId = request.employee._id || request.employee;
  const dates = eachDate(request.fromDate, request.toDate);
  if (!dates.length || dates[dates.length - 1] < request.toDate) {
    return { error: `Date range cannot be longer than ${MAX_DAYS} days` };
  }
  for (const date of dates) {
    const { shift, company, branch } = await getAssignedShift(employeeId, date);
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) record = new Attendance({ employee: employeeId, date });
    if (company?._id) record.companyId = company._id;
    if (branch?._id) record.branchId = branch._id;
    const shiftId = shiftDbId(shift);
    if (shiftId) record.shift = shiftId;
    record.status = "Present";
    if (request.dutyType === "On Tour") {
      record.onTourId = request._id;
      record.onDutyId = null;
    } else {
      record.onDutyId = request._id;
      record.onTourId = null;
    }
    record.markedBy = actorId;
    record.markReason = request.reason || "";
    if (request.remarks) record.remarks = request.remarks;
    if (!record.punchIn && !record.punchOut) {
      const start = parseHm(shift?.startTime);
      const end = parseHm(shift?.endTime);
      record.workedMinutes = start != null && end != null && end > start ? end - start : 0;
      record.overtimeMinutes = 0;
      record.lateByMinutes = 0;
      record.earlyByMinutes = 0;
    }
    await record.save();
  }
  return { days: dates.length };
};

/** Rejected days with no punch are Absent. A punched office day is left as it is. */
const saveRejectedDays = async (request, actorId) => {
  const employeeId = request.employee._id || request.employee;
  for (const date of eachDate(request.fromDate, request.toDate)) {
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) record = new Attendance({ employee: employeeId, date });
    const linked =
      String(record.onTourId || "") === String(request._id) ||
      String(record.onDutyId || "") === String(request._id);
    if (record.punchIn && !linked) continue;
    const { shift, company, branch } = await getAssignedShift(employeeId, date);
    if (company?._id) record.companyId = company._id;
    if (branch?._id) record.branchId = branch._id;
    const shiftId = shiftDbId(shift);
    if (shiftId) record.shift = shiftId;
    record.status = "Absent";
    record.onTourId = null;
    record.onDutyId = null;
    record.markedBy = actorId;
    record.markReason = request.reason || "";
    if (!record.punchIn) {
      record.workedMinutes = 0;
      record.overtimeMinutes = 0;
      record.lateByMinutes = 0;
      record.earlyByMinutes = 0;
    }
    await record.save();
  }
};

/** POST /api/attendance/tour-duty */
const requestTourDuty = async (req, res) => {
  try {
    if (normalizeRoleName(req.user.role) !== EMPLOYEE) {
      return res.status(403).json({ message: "Only an employee can apply On Tour or On Duty" });
    }
    const fromTime = normalizeHm(req.body.fromTime);
    const toTime = normalizeHm(req.body.toTime);
    if (!fromTime || !toTime) {
      return res.status(400).json({ message: "fromTime and toTime must look like 09:00" });
    }
    const { fromDate, toDate, dutyType } = req.body;
    if (fromDate > toDate) {
      return res.status(400).json({ message: "From date cannot be after to date" });
    }
    if (fromDate === toDate && toTime <= fromTime) {
      return res.status(400).json({ message: "To time must be after from time" });
    }
    const days = inclusiveDays(fromDate, toDate);
    if (days > MAX_DAYS) {
      return res.status(400).json({ message: `Date range cannot be longer than ${MAX_DAYS} days` });
    }
    const category = await loadCategory(dutyType, req.body.tourCategory);
    if (!category) {
      return res.status(400).json({
        message:
          dutyType === "On Tour"
            ? "tourCategory must be an active On Tour category id"
            : "tourCategory must be an active On Duty category id",
      });
    }

    const employee = await User.findById(req.user._id).select(CARD);
    if (!employee || employee.status === "Deleted") {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (await leaveConflict(employee._id, fromDate, toDate)) {
      return res.status(400).json({ message: "These dates already have a leave request" });
    }
    if (await overlapConflict(employee._id, fromDate, toDate)) {
      return res.status(400).json({ message: "These dates already have an On Tour or On Duty request" });
    }

    const doc = await TourDuty.create({
      employee: employee._id,
      companyId: userCompanyIds(employee)[0] || null,
      dutyType,
      tourCategory: category._id,
      fromDate,
      fromTime,
      toDate,
      toTime,
      reason: String(req.body.reason || "").trim(),
      remarks: String(req.body.remarks || "").trim(),
      document: String(req.body.document || "").trim(),
    });
    return res.status(201).json({
      message: "Request sent. It stays Pending until approved. Attendance updates after approval.",
      request: await rowWithCategory({ ...doc.toObject(), employee }),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/tour-duty */
const myTourDuty = (req, res) =>
  sendList(res, { employee: req.user._id }, req.query).catch((err) =>
    res.status(500).json({ message: err.message })
  );

/** GET /api/attendance/tour-duty/:id */
const getTourDuty = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Request is not valid" });
    }
    const doc = await TourDuty.findById(req.params.id)
      .populate("employee", CARD)
      .populate("reviewedBy", "name role official.officialEmail official.employeeCode official.department");
    if (!doc) return res.status(404).json({ message: "Request not found" });
    const owner = String(doc.employee._id || doc.employee) === String(req.user._id);
    if (!owner) {
      if (normalizeRoleName(req.user.role) === EMPLOYEE) {
        return res.status(403).json({ message: "You can only view your own request" });
      }
      const scopeErr = assertTeamOrCompanyEmployee(req.user, doc.employee);
      if (scopeErr) return res.status(403).json({ message: scopeErr });
    }
    return res.json({ request: await rowWithCategory(doc) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** POST /api/attendance/tour-duty/:id/cancel */
const cancelTourDuty = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Request is not valid" });
    }
    const doc = await TourDuty.findById(req.params.id).populate("employee", CARD);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (String(doc.employee._id || doc.employee) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only cancel your own request" });
    }
    if (doc.status !== "Pending") {
      return res.status(400).json({ message: `Cannot cancel a ${doc.status} request` });
    }
    doc.status = "Cancelled";
    await doc.save();
    return res.json({ message: "Request cancelled", request: await rowWithCategory(doc) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/tour-duties */
const listTourDuty = async (req, res) => {
  try {
    if (normalizeRoleName(req.user.role) === EMPLOYEE) {
      return res.status(403).json({ message: "Use your own On Tour / On Duty list" });
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

/** POST /api/attendance/tour-duties/:id/review */
const reviewTourDuty = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Request is not valid" });
    }
    const role = normalizeRoleName(req.user.role);
    if (!REVIEW_ROLES.has(role)) {
      return res.status(403).json({
        message: "Only a Reporting Manager, HR, or Super Admin can approve or reject",
      });
    }
    const decision = String(req.body.decision || "").toLowerCase();
    const doc = await TourDuty.findById(req.params.id).populate("employee", CARD);
    if (!doc) return res.status(404).json({ message: "Request not found" });
    if (String(doc.employee._id || doc.employee) === String(req.user._id)) {
      return res.status(403).json({ message: "You cannot review your own request" });
    }
    const scopeErr = assertTeamOrCompanyEmployee(req.user, doc.employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });
    if (doc.status !== "Pending") {
      return res.status(400).json({ message: `Request is already ${doc.status}` });
    }
    if (decision === "approve") {
      if (await leaveConflict(doc.employee._id, doc.fromDate, doc.toDate)) {
        return res.status(400).json({ message: "These dates already have a leave request" });
      }
      const saved = await saveApprovedDays(doc, req.user._id);
      if (saved.error) return res.status(400).json({ message: saved.error });
      doc.status = "Approved";
    } else {
      doc.status = "Rejected";
      await saveRejectedDays(doc, req.user._id);
    }
    doc.reviewedBy = req.user._id;
    doc.reviewedAt = new Date();
    doc.reviewReason = String(req.body.reason || "").trim();
    await doc.save();
    const fresh = await TourDuty.findById(doc._id)
      .populate("employee", CARD)
      .populate("reviewedBy", "name role official.officialEmail official.employeeCode official.department");
    return res.json({
      message:
        decision === "approve"
          ? "Approved. Attendance for these days is Present."
          : "Rejected. Attendance for these days is Absent.",
      request: await rowWithCategory(fresh),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  requestTourDuty,
  myTourDuty,
  getTourDuty,
  cancelTourDuty,
  listTourDuty,
  reviewTourDuty,
};
