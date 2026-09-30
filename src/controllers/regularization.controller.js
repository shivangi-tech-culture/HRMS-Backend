/**
 * REGULARIZATION CONTROLLER — /api/attendance/regularize
 *
 * UI: Attendance → Attendance Regularization
 *   - List + filters
 *   - New Regularization Request (admin can pick employee)
 *   - Approve / Reject / Cancel
 */
const AttendanceRegularization = require("../models/AttendanceRegularization");
const {
  REG_TYPES,
  REG_REASONS,
  STATUSES,
} = require("../models/AttendanceRegularization");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const {
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { listScopeFilter, assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const {
  getAssignedShift,
  computeDayMetrics,
  todayDate,
} = require("../utils/shiftTiming");
const { formatDisplayDate } = require("../utils/attendanceView");
const { listAttendanceMasterNames } = require("../utils/attendanceMasters");

const combineDateTime = (dateStr, timeStr) => {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return d;
};

/** Infer UI type when client does not send type */
const inferRegType = (inTime, outTime, explicit) => {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const hasIn = !!(inTime && String(inTime).trim());
  const hasOut = !!(outTime && String(outTime).trim());
  if (hasIn && !hasOut) return "Missed Punch In";
  if (!hasIn && hasOut) return "Missed Punch Out";
  if (hasIn && hasOut) return "Wrong Status";
  return "Missed Punch In";
};

/** Normalize create body aliases from UI form */
const normalizeCreateBody = (body = {}) => {
  const sheetDate = body.sheetDate || body.date || null;
  const requestedInTime =
    body.requestedInTime || body.requestedPunchIn || body.punchIn || null;
  const requestedOutTime =
    body.requestedOutTime || body.requestedPunchOut || body.punchOut || null;
  const employeeId = body.employeeId || body.employee || null;
  const type = body.type || "";
  const reason = body.reason || "";
  const remarks = body.remarks || "";
  return {
    sheetDate,
    requestedInTime: requestedInTime || null,
    requestedOutTime: requestedOutTime || null,
    employeeId,
    type,
    reason,
    remarks,
  };
};

const enrichRegRow = (row) => {
  const o = row.toObject ? row.toObject() : { ...row };
  const emp = o.employee || {};
  return {
    ...o,
    displayDate: formatDisplayDate(o.sheetDate),
    requestedInDisplay: o.requestedInTime || null,
    requestedOutDisplay: o.requestedOutTime || null,
    requestedDisplay: [o.requestedInTime, o.requestedOutTime]
      .filter(Boolean)
      .join(" — ") || "—",
    employee: {
      _id: emp._id,
      name: emp.name || "",
      employeeCode: emp.official?.employeeCode || "",
      department: emp.official?.department || "",
      role: emp.role || "",
    },
  };
};

/**
 * META — GET /api/attendance/regularize/meta
 * Types hardcoded; reasons from Master type=regularizationReason
 */
const getRegularizationMeta = async (req, res) => {
  try {
    const reasons = await listAttendanceMasterNames(
      "regularizationReason",
      req.user
    );
    return res.json({
      types: REG_TYPES,
      reasons: reasons.length ? reasons : REG_REASONS,
      reasonMasterType: "regularizationReason",
      statuses: STATUSES,
      today: todayDate(),
      note: "Reasons from Masters → type=regularizationReason (GET /api/masters?type=regularizationReason)",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * CREATE — POST /api/attendance/regularize
 * Body (UI form):
 *   employeeId? (admin), date/sheetDate, type, requestedInTime, requestedOutTime,
 *   reason (required), remarks?
 */
const createRegularization = async (req, res) => {
  try {
    const {
      sheetDate,
      requestedInTime,
      requestedOutTime,
      employeeId,
      type,
      reason,
      remarks,
    } = normalizeCreateBody(req.body);

    if (!sheetDate) {
      return res.status(400).json({ message: "date / sheetDate is required" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "reason is required" });
    }
    if (!requestedInTime && !requestedOutTime) {
      return res.status(400).json({
        message: "Provide requestedPunchIn and/or requestedPunchOut (HH:mm)",
      });
    }

    let targetId = req.user._id;

    // Admin can submit for another employee (Employee dropdown)
    if (employeeId && String(employeeId) !== String(req.user._id)) {
      if (!hasAllAccess(req.user)) {
        return res.status(403).json({
          message: "Only admin can create regularization for another employee",
        });
      }
      const emp = await User.findById(employeeId).select(
        "_id name status role official.company official.employeeCode"
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });
      if (emp.status !== "Active") {
        return res.status(400).json({ message: "Employee is inactive" });
      }
      if (!hasGlobalCompanyAccess(req.user)) {
        const errMsg = assertTeamOrCompanyEmployee(req.user, emp);
        if (errMsg) return res.status(403).json({ message: errMsg });
      }
      targetId = emp._id;
    }

    const existing = await AttendanceRegularization.findOne({
      employee: targetId,
      sheetDate,
      status: "Pending",
    });
    if (existing) {
      return res.status(400).json({
        message: "A pending regularization already exists for this date",
        data: enrichRegRow(existing),
      });
    }

    const row = await AttendanceRegularization.create({
      employee: targetId,
      sheetDate,
      requestedInTime: requestedInTime || null,
      requestedOutTime: requestedOutTime || null,
      type: inferRegType(requestedInTime, requestedOutTime, type),
      reason: String(reason).trim(),
      remarks: remarks || "",
      status: "Pending",
      submittedBy: req.user._id,
      submitDate: new Date(),
    });

    await row.populate(
      "employee",
      "name role official.employeeCode official.department"
    );
    await row.populate("submittedBy", "name role");

    return res.status(201).json({
      message: "Regularization request submitted",
      data: enrichRegRow(row),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * LIST — GET /api/attendance/regularize
 * Filters: status, type, search, reason, year, from, to, employeeId, page, limit
 */
const listRegularizations = async (req, res) => {
  try {
    const {
      status,
      type,
      reason,
      search,
      year,
      from,
      to,
      employeeId,
      page,
      limit,
    } = req.query;
    const filter = {};

    if (!hasAllAccess(req.user)) {
      filter.employee = req.user._id;
    } else if (employeeId) {
      filter.employee = employeeId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const scope = listScopeFilter(req.user);
      if (scope === false) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      if (scope) {
        const users = await User.find(scope).select("_id").lean();
        filter.employee = { $in: users.map((u) => u._id) };
      }
    }

    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const userFilter = {
        $or: [
          { name: new RegExp(q, "i") },
          { "official.employeeCode": new RegExp(q, "i") },
        ],
      };
      if (filter.employee) {
        if (filter.employee.$in) userFilter._id = { $in: filter.employee.$in };
        else userFilter._id = filter.employee;
      }
      const matched = await User.find(userFilter).select("_id").lean();
      filter.employee = { $in: matched.map((u) => u._id) };
      if (matched.length === 0) {
        return res.json({
          total: 0,
          page,
          limit,
          pages: 1,
          data: [],
          filters: {
            status: status || "ALL",
            type: type || "",
            reason: reason || "",
            search: search || "",
            year: year || "",
            from: from || null,
            to: to || null,
          },
        });
      }
    }

    if (status && status !== "ALL") filter.status = status;
    if (type && String(type).trim()) {
      filter.type = new RegExp(
        `^${String(type).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }
    if (reason && String(reason).trim()) {
      filter.reason = new RegExp(
        `^${String(reason).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }

    if (from || to) {
      filter.sheetDate = {};
      if (from) filter.sheetDate.$gte = from;
      if (to) filter.sheetDate.$lte = to;
    } else if (year) {
      const y = String(year).slice(0, 4);
      filter.sheetDate = new RegExp(`^${y}`);
    }

    const skip = (page - 1) * limit;
    const [total, rows] = await Promise.all([
      AttendanceRegularization.countDocuments(filter),
      AttendanceRegularization.find(filter)
        .populate(
          "employee",
          "name role official.employeeCode official.department"
        )
        .populate("reviewedBy", "name role")
        .populate("submittedBy", "name role")
        .sort({ submitDate: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        status: status || "ALL",
        type: type || "",
        reason: reason || "",
        search: search || "",
        year: year || "",
        from: from || null,
        to: to || null,
      },
      data: rows.map(enrichRegRow),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET ONE — GET /api/attendance/regularize/:id */
const getRegularization = async (req, res) => {
  try {
    const row = await AttendanceRegularization.findById(req.params.id)
      .populate(
        "employee",
        "name role official.employeeCode official.department"
      )
      .populate("reviewedBy", "name role")
      .populate("submittedBy", "name role");

    if (!row) return res.status(404).json({ message: "Request not found" });

    if (
      !hasAllAccess(req.user) &&
      String(row.employee._id) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    return res.json({ data: enrichRegRow(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** CANCEL — POST /api/attendance/regularize/:id/cancel */
const cancelRegularization = async (req, res) => {
  try {
    const row = await AttendanceRegularization.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Request not found" });

    if (
      String(row.employee) !== String(req.user._id) &&
      !hasAllAccess(req.user)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (row.status !== "Pending") {
      return res
        .status(400)
        .json({ message: "Only pending requests can be cancelled" });
    }

    row.status = "Cancelled";
    await row.save();
    await row.populate(
      "employee",
      "name role official.employeeCode official.department"
    );
    return res.json({ message: "Request cancelled", data: enrichRegRow(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** REVIEW — POST /api/attendance/regularize/:id/review (admin approve/reject) */
const reviewRegularization = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const row = await AttendanceRegularization.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Request not found" });
    if (row.status !== "Pending") {
      return res
        .status(400)
        .json({ message: `Request is already ${row.status}` });
    }

    const employee = await User.findById(row.employee).select(
      "_id official.company"
    );
    if (!hasGlobalCompanyAccess(req.user)) {
      const err = assertTeamOrCompanyEmployee(req.user, employee);
      if (err) return res.status(403).json({ message: err });
    }

    row.status = req.body.status;
    row.reviewRemarks = req.body.reviewRemarks || "";
    row.reviewedBy = req.user._id;
    row.reviewedAt = new Date();
    await row.save();

    if (req.body.status === "Approved") {
      let attendance = await Attendance.findOne({
        employee: row.employee,
        date: row.sheetDate,
      });
      if (!attendance) {
        attendance = new Attendance({
          employee: row.employee,
          date: row.sheetDate,
        });
      }

      const assigned = await getAssignedShift(row.employee, row.sheetDate);
      if (assigned?.shift && !assigned.shift.isDefault) {
        attendance.shift = assigned.shift._id;
      }

      if (row.requestedInTime) {
        attendance.punchIn = combineDateTime(row.sheetDate, row.requestedInTime);
        attendance.punchInSource = "manual";
      }
      if (row.requestedOutTime) {
        attendance.punchOut = combineDateTime(
          row.sheetDate,
          row.requestedOutTime
        );
        attendance.punchOutSource = "manual";
      }

      attendance.reason = row.reason || row.remarks || "";
      attendance.remarks = `Regularized: ${row.reason || ""}${
        row.remarks ? ` — ${row.remarks}` : ""
      }`.trim();
      attendance.markedBy = req.user._id;

      const metrics = computeDayMetrics(
        attendance,
        assigned?.shift || null,
        row.sheetDate
      );
      attendance.status = metrics.status;
      attendance.workedMinutes = metrics.workedMinutes;
      attendance.lateByMinutes = metrics.lateByMinutes;
      attendance.earlyByMinutes = metrics.earlyByMinutes;
      await attendance.save();
    }

    await row.populate(
      "employee",
      "name role official.employeeCode official.department"
    );
    await row.populate("reviewedBy", "name role");

    return res.json({
      message: `Request ${req.body.status.toLowerCase()}`,
      data: enrichRegRow(row),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getRegularizationMeta,
  createRegularization,
  listRegularizations,
  getRegularization,
  cancelRegularization,
  reviewRegularization,
};
