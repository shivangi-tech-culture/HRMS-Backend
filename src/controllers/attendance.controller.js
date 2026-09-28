/**
 * ATTENDANCE CONTROLLER — /api/attendance
 *
 * Punch-in / punch-out (simple):
 * 1. Client sends source + lat + long only (no address in body)
 * 2. Server fetches address from Map API (Google / OSM) → saves lat, long, address in DB
 * 3. Attach employee's assigned shift (Morning / Evening / whatever is assigned)
 * 4. Punch-in without punch-out → Absent (timesheet + close-absent)
 */
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const {
  assertSameCompanyEmployee,
  companyFilter,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { SELF_SOURCES } = require("../validators/attendance.validation");
const { resolvePunchLocation } = require("../utils/geocode");
const {
  todayDate,
  getAssignedShift,
  validatePunchAgainstShift,
  computeDayMetrics,
} = require("../utils/shiftTiming");

const today = todayDate;

/** Combine YYYY-MM-DD + HH:mm into Date (UTC clock storage) */
const combineDateTime = (dateStr, timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCHours(h, m, 0, 0);
  return d;
};

const assertSelfSource = (source) => {
  if (!SELF_SOURCES.includes(source)) {
    return "Self punch source must be web, mobile, or biometric. Manual is admin-only.";
  }
  return null;
};

const shiftSummary = (shift) =>
  shift
    ? {
        _id: shift._id,
        code: shift.code || "",
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        halfDayEndTime: shift.halfDayEndTime || "14:30",
      }
    : null;

const applyMetrics = (record, shift) => {
  const metrics = computeDayMetrics(record, shift, record.date);
  record.status = metrics.status;
  record.workedMinutes = metrics.workedMinutes;
  record.lateByMinutes = metrics.lateByMinutes;
  record.earlyByMinutes = metrics.earlyByMinutes;
  return metrics;
};

/**
 * PUNCH IN — POST /api/attendance/punch-in
 * Body: { source, latitude, longitude, remarks? }
 * Address is NOT accepted from client — fetched via Map API from lat/long.
 */
const punchIn = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();

    // Assigned shift for this employee today (Shift Assignment → fallback official.shift)
    const assigned = await getAssignedShift(employeeId, date);
    const shift = assigned?.shift || null;

    const windowCheck = validatePunchAgainstShift(shift, now, "in", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    // lat/long saved; address always from Map API (not from body)
    const location = await resolvePunchLocation(req.body);

    let record = await Attendance.findOne({ employee: employeeId, date });
    if (record && record.punchIn) {
      return res.status(400).json({ message: "Already punched in today", record });
    }

    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    record.punchIn = now;
    record.punchInSource = source;
    record.punchInLocation = location;
    record.shift = shift?._id || null;
    record.status = "Pending"; // waiting for punch-out
    record.workedMinutes = 0;
    if (req.body.remarks) record.remarks = req.body.remarks;
    await record.save();

    await record.populate("shift");
    await record.populate(
      "employee",
      "name role official.employeeCode official.department"
    );

    return res.status(201).json({
      message: windowCheck.isEarly
        ? "Punched in (early — before shift start, allowed)"
        : "Punched in successfully",
      source,
      shift: shiftSummary(shift),
      location,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUNCH OUT — POST /api/attendance/punch-out
 * Same geo save. Uses shift saved on punch-in (or re-resolves assignment).
 */
const punchOut = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();

    const record = await Attendance.findOne({ employee: employeeId, date });
    if (!record || !record.punchIn) {
      return res.status(400).json({ message: "Please punch in first" });
    }
    if (record.punchOut) {
      return res.status(400).json({ message: "Already punched out today", record });
    }

    let shift = null;
    if (record.shift) {
      const { getShiftById } = require("../utils/shiftTiming");
      shift = await getShiftById(record.shift);
    }
    if (!shift) {
      const assigned = await getAssignedShift(employeeId, date);
      shift = assigned?.shift || null;
      if (shift) record.shift = shift._id;
    }

    const windowCheck = validatePunchAgainstShift(shift, now, "out", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    const location = await resolvePunchLocation(req.body);

    record.punchOut = now;
    record.punchOutSource = source;
    record.punchOutLocation = location;
    if (req.body.remarks) record.remarks = req.body.remarks;
    applyMetrics(record, shift);
    await record.save();

    await record.populate("shift");
    await record.populate(
      "employee",
      "name role official.employeeCode official.department"
    );

    return res.json({
      message: windowCheck.isLate
        ? "Punched out (after shift end — allowed)"
        : "Punched out successfully",
      source,
      shift: shiftSummary(shift),
      location,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MANUAL MARK — POST /api/attendance/manual
 */
const markManual = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({
        message: "Only Super Admin / HR Manager / Manager can mark attendance manually",
      });
    }

    const { employeeId, punchType, time, reason, remarks } = req.body;
    const date = today();

    const employee = await User.findById(employeeId).select(
      "_id name status official.company"
    );
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "Active") {
      return res.status(400).json({ message: "Employee is inactive" });
    }

    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    const punchAt = combineDateTime(date, time);
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    const assigned = await getAssignedShift(employeeId, date);
    if (assigned?.shift) record.shift = assigned.shift._id;

    if (punchType === "in") {
      record.punchIn = punchAt;
      record.punchInSource = "manual";
      record.status = record.punchOut ? record.status : "Pending";
    } else {
      if (!record.punchIn) {
        return res.status(400).json({
          message: "Cannot mark punch-out — punch-in is missing for today",
        });
      }
      if (punchAt < record.punchIn) {
        return res.status(400).json({
          message: "Punch-out time cannot be before punch-in time",
        });
      }
      record.punchOut = punchAt;
      record.punchOutSource = "manual";
    }

    record.reason = reason;
    record.remarks = remarks || "";
    record.markedBy = req.user._id;
    applyMetrics(record, assigned?.shift || null);
    await record.save();

    await record.populate(
      "employee",
      "name role official.officialEmail official.employeeCode official.department"
    );
    await record.populate("markedBy", "name role");
    await record.populate("shift");

    return res.status(201).json({
      message: "Manual attendance saved (audit logged)",
      source: "manual",
      date,
      punchType,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** MY TODAY — GET /api/attendance/today */
const myToday = async (req, res) => {
  try {
    const date = today();
    let record = await Attendance.findOne({
      employee: req.user._id,
      date,
    }).populate("shift");

    const assigned = await getAssignedShift(req.user._id, date);
    const shift = assigned?.shift || record?.shift || null;

    // Sync old rows: attach assigned shift + recompute status if both punches exist
    if (record && shift) {
      let dirty = false;
      if (!record.shift) {
        record.shift = shift._id || shift;
        dirty = true;
      }
      if (record.punchIn && record.punchOut && record.status === "Pending") {
        applyMetrics(record, shift);
        dirty = true;
      }
      if (dirty) {
        await record.save();
        await record.populate("shift");
      }
    }

    return res.json({
      date,
      assignedShift: assigned?.shift || null,
      record: record || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Build employee scope filter for list APIs */
const buildEmployeeScope = async (req) => {
  if (!hasAllAccess(req.user)) {
    return { employee: req.user._id };
  }
  if (req.query.employeeId) {
    return { employee: req.query.employeeId };
  }
  if (!hasGlobalCompanyAccess(req.user)) {
    const scope = companyFilter(req.user);
    if (scope === false) return { error: "Your profile has no company — cannot list attendance" };
    if (scope) {
      const companyUsers = await User.find(scope).select("_id").lean();
      return { employee: { $in: companyUsers.map((u) => u._id) } };
    }
  }
  return {};
};

/**
 * LIST — GET /api/attendance
 * Filters: date|from|to, source, status, employeeId, page, limit
 */
const listAttendance = async (req, res) => {
  try {
    const scope = await buildEmployeeScope(req);
    if (scope.error) return res.status(403).json({ message: scope.error });

    const filter = { ...scope };
    const { date, from, to, source, status, page, limit } = req.query;

    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    if (source) {
      filter.$or = [{ punchInSource: source }, { punchOutSource: source }];
    }
    if (status && status !== "ALL") filter.status = status;

    const skip = (page - 1) * limit;
    const [total, records] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter)
        .populate(
          "employee",
          "name role official.officialEmail official.employeeCode official.department"
        )
        .populate("markedBy", "name role")
        .populate("shift")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      count: records.length,
      records,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MY WEB PUNCHES — GET /api/attendance/web-punches
 * Flattens IN/OUT rows with lat/long/address (ESS My Web Punches)
 */
const listWebPunches = async (req, res) => {
  try {
    const scope = await buildEmployeeScope(req);
    if (scope.error) return res.status(403).json({ message: scope.error });

    const filter = { ...scope };
    const { from, to, date, status, page, limit } = req.query;

    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (status && status !== "ALL") filter.status = status;

    const records = await Attendance.find(filter)
      .populate("employee", "name official.employeeCode")
      .populate("shift", "name startTime endTime")
      .sort({ date: -1, punchIn: -1 })
      .lean();

    const punches = [];
    for (const r of records) {
      if (r.punchIn) {
        punches.push({
          _id: `${r._id}-in`,
          attendanceId: r._id,
          employee: r.employee,
          shift: r.shift,
          status: r.status,
          punchTime: r.punchIn,
          punchMode: "IN",
          punchType: r.punchInSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchInLocation || {},
          remarks: r.remarks || "",
          source: r.punchInSource,
          date: r.date,
        });
      }
      if (r.punchOut) {
        punches.push({
          _id: `${r._id}-out`,
          attendanceId: r._id,
          employee: r.employee,
          shift: r.shift,
          status: r.status,
          punchTime: r.punchOut,
          punchMode: "OUT",
          punchType: r.punchOutSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchOutLocation || {},
          remarks: r.remarks || "",
          source: r.punchOutSource,
          date: r.date,
        });
      }
    }

    punches.sort((a, b) => new Date(b.punchTime) - new Date(a.punchTime));

    const p = page || 1;
    const l = limit || 50;
    const total = punches.length;
    const start = (p - 1) * l;
    const data = punches.slice(start, start + l);

    return res.json({
      total,
      page: p,
      limit: l,
      pages: Math.max(1, Math.ceil(total / l)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * CLOSE ABSENT — POST /api/attendance/close-absent
 * Marks past days with punch-in and no punch-out as Absent.
 * Admin: company scope. Optional body: { date?, employeeId? }
 */
const closeAbsent = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const before = today();
    const filter = {
      date: { $lt: before },
      punchIn: { $ne: null },
      punchOut: null,
      status: { $nin: ["Absent"] },
    };

    if (req.body?.employeeId) filter.employee = req.body.employeeId;
    else if (req.body?.date) filter.date = req.body.date;
    else if (!hasGlobalCompanyAccess(req.user)) {
      const scope = companyFilter(req.user);
      if (scope === false) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      if (scope) {
        const users = await User.find(scope).select("_id").lean();
        filter.employee = { $in: users.map((u) => u._id) };
      }
    }

    const result = await Attendance.updateMany(filter, {
      $set: {
        status: "Absent",
        workedMinutes: 0,
        reason: "Punched in but no punch-out",
      },
    });

    return res.json({
      message: "Marked Absent where punch-in exists without punch-out",
      matched: result.matchedCount ?? result.n,
      modified: result.modifiedCount ?? result.nModified,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  punchIn,
  punchOut,
  markManual,
  myToday,
  listAttendance,
  listWebPunches,
  closeAbsent,
};
