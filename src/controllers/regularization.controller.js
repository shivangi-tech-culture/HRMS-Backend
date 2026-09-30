/**
 * REGULARIZATION CONTROLLER — /api/attendance/regularize
 * Employee create/cancel; Admin approve/reject (updates Attendance)
 */
const AttendanceRegularization = require("../models/AttendanceRegularization");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const {
  companyFilter,
  hasGlobalCompanyAccess,
  assertSameCompanyEmployee,
} = require("../utils/companyScope");
const {
  getAssignedShift,
  computeDayMetrics,
} = require("../utils/shiftTiming");

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
  return "";
};

/** CREATE — POST /api/attendance/regularize */
const createRegularization = async (req, res) => {
  try {
    const { sheetDate, requestedInTime, requestedOutTime, remarks, type } =
      req.body;
    const employeeId = req.user._id;

    const existing = await AttendanceRegularization.findOne({
      employee: employeeId,
      sheetDate,
      status: "Pending",
    });
    if (existing) {
      return res.status(400).json({
        message: "A pending regularization already exists for this date",
        data: existing,
      });
    }

    const row = await AttendanceRegularization.create({
      employee: employeeId,
      sheetDate,
      requestedInTime: requestedInTime || null,
      requestedOutTime: requestedOutTime || null,
      type: inferRegType(requestedInTime, requestedOutTime, type),
      remarks,
      status: "Pending",
      submittedBy: employeeId,
      submitDate: new Date(),
    });

    await row.populate("employee", "name official.employeeCode");

    return res.status(201).json({
      message: "Regularization request submitted",
      data: row,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** LIST — GET /api/attendance/regularize
 * Filters: status, type, search (name/code), year, from, to, employeeId, page, limit
 * Matches UI: https://hrms-techculture.vercel.app/attendance/regularization
 */
const listRegularizations = async (req, res) => {
  try {
    const { status, type, search, year, from, to, employeeId, page, limit } =
      req.query;
    const filter = {};

    if (!hasAllAccess(req.user)) {
      filter.employee = req.user._id;
    } else if (employeeId) {
      filter.employee = employeeId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const scope = companyFilter(req.user);
      if (scope === false) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      if (scope) {
        const users = await User.find(scope).select("_id").lean();
        filter.employee = { $in: users.map((u) => u._id) };
      }
    }

    // Search name / employee code → employee ids
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

    // Date filters on sheetDate
    if (from || to) {
      filter.sheetDate = {};
      if (from) filter.sheetDate.$gte = from;
      if (to) filter.sheetDate.$lte = to;
    } else if (year) {
      const y = String(year).slice(0, 4);
      filter.sheetDate = new RegExp(`^${y}`);
    }

    const skip = (page - 1) * limit;
    const [total, data] = await Promise.all([
      AttendanceRegularization.countDocuments(filter),
      AttendanceRegularization.find(filter)
        .populate(
          "employee",
          "name role official.employeeCode official.department"
        )
        .populate("reviewedBy", "name role")
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
        search: search || "",
        year: year || "",
        from: from || null,
        to: to || null,
      },
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET ONE — GET /api/attendance/regularize/:id */
const getRegularization = async (req, res) => {
  try {
    const row = await AttendanceRegularization.findById(req.params.id)
      .populate("employee", "name role official.employeeCode official.department")
      .populate("reviewedBy", "name role")
      .populate("submittedBy", "name role");

    if (!row) return res.status(404).json({ message: "Request not found" });

    if (!hasAllAccess(req.user) && String(row.employee._id) !== String(req.user._id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    return res.json({ data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** CANCEL — POST /api/attendance/regularize/:id/cancel (employee own pending) */
const cancelRegularization = async (req, res) => {
  try {
    const row = await AttendanceRegularization.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Request not found" });

    if (String(row.employee) !== String(req.user._id) && !hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (row.status !== "Pending") {
      return res.status(400).json({ message: "Only pending requests can be cancelled" });
    }

    row.status = "Cancelled";
    await row.save();
    return res.json({ message: "Request cancelled", data: row });
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
      return res.status(400).json({ message: `Request is already ${row.status}` });
    }

    const employee = await User.findById(row.employee).select(
      "_id official.company"
    );
    if (!hasGlobalCompanyAccess(req.user)) {
      const err = assertSameCompanyEmployee(req.user, employee);
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
      if (assigned?.shift) attendance.shift = assigned.shift._id;

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

      attendance.reason = row.remarks;
      attendance.remarks = `Regularized: ${row.remarks}`;
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

    await row.populate("employee", "name official.employeeCode");
    await row.populate("reviewedBy", "name role");

    return res.json({
      message: `Request ${req.body.status.toLowerCase()}`,
      data: row,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createRegularization,
  listRegularizations,
  getRegularization,
  cancelRegularization,
  reviewRegularization,
};
