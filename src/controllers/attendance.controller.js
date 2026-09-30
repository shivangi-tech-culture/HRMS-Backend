/**
 * ATTENDANCE CONTROLLER — APIs under /api/attendance
 *
 * Punch flow (simple):
 * 1. Body: source + latitude + longitude (address NOT from client)
 * 2. getAssignedShift → assignment shift OR default 10:00–19:00 grace 10
 * 3. validatePunchAgainstShift → time window OK?
 * 4. Map API → address from lat/long
 * 5. Save Attendance (one row per employee per day)
 */
const Attendance = require("../models/Attendance"); // daily punch document
const User = require("../models/User"); // employee lookup (manual / scope)
const { hasAllAccess } = require("../middleware/auth"); // admin/HR/manager roles
const {
  assertSameCompanyEmployee, // same company check
  companyFilter, // company scope for list
  hasGlobalCompanyAccess, // global admin?
} = require("../utils/companyScope");
const { SELF_SOURCES } = require("../validators/attendance.validation"); // web|mobile|biometric
const { resolvePunchLocation } = require("../utils/geocode"); // lat/long → address
const {
  todayDate, // YYYY-MM-DD in app TZ
  getAssignedShift, // assignment OR default shift
  validatePunchAgainstShift, // punch time gatekeeper
  computeDayMetrics, // Present / Absent / late / early
} = require("../utils/shiftTiming");

const today = todayDate; // alias used in this file

/**
 * Manual mark helper: "2026-09-29" + "09:30" → Date
 * Stores clock as UTC hours (same pattern as existing manual API)
 */
const combineDateTime = (dateStr, timeStr) => {
  const [h, m] = timeStr.split(":").map(Number); // hour, minute from "HH:mm"
  const d = new Date(`${dateStr}T00:00:00.000Z`); // base midnight UTC
  d.setUTCHours(h, m, 0, 0); // set punch clock
  return d;
};

/**
 * Self punch must be web / mobile / biometric (not "manual")
 * @returns {string|null} error message or null if OK
 */
const assertSelfSource = (source) => {
  if (!SELF_SOURCES.includes(source)) {
    return "Self punch source must be web, mobile, or biometric. Manual is admin-only.";
  }
  return null; // OK
};

/**
 * Small shift object for API response (UI card)
 * isDefault=true means no Shift Assignment — using 10–7 default
 */
const shiftSummary = (shift) =>
  shift
    ? {
        _id: shift._id || null, // null when default (no DB Shift doc)
        code: shift.code || "",
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        halfDayEndTime: shift.halfDayEndTime || "14:30",
        graceMinutes: Number(shift.graceMinutes || 0),
        isDefault: !!shift.isDefault, // true = default shift
      }
    : null;

/**
 * Attendance.shift field needs real Mongo ObjectId only.
 * Default shift has no _id → return null (don't save fake id)
 */
const shiftDbId = (shift) =>
  shift && !shift.isDefault && shift._id ? shift._id : null;

/**
 * After punch-out / manual: copy metrics onto attendance row
 * (status, workedMinutes, lateByMinutes, earlyByMinutes)
 */
const applyMetrics = (record, shift) => {
  const metrics = computeDayMetrics(record, shift, record.date);
  record.status = metrics.status; // Present | Absent | HalfDay | …
  record.workedMinutes = metrics.workedMinutes;
  record.lateByMinutes = metrics.lateByMinutes;
  record.earlyByMinutes = metrics.earlyByMinutes;
  return metrics;
};

/**
 * PUNCH IN — POST /api/attendance/punch-in
 * Body: { source, latitude, longitude, remarks? }
 */
const punchIn = async (req, res) => {
  try {
    // 1) Source must be self-punch type
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id; // logged-in employee
    const date = today(); // today's date YYYY-MM-DD
    const source = req.body.source; // web | mobile | biometric
    const now = new Date(); // punch timestamp

    // 2) Shift: from Shift Assignment, else default 10:00–19:00 grace 10
    const { shift } = await getAssignedShift(employeeId, date);

    // 3) Gatekeeper: punchStart / early rules — fail → no save
    const windowCheck = validatePunchAgainstShift(shift, now, "in", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    // 4) Geo: lat/long from body → address from Map API
    const location = await resolvePunchLocation(req.body);

    // 5) One attendance row per employee per day
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (record && record.punchIn) {
      // Already punched in today — block double in
      return res.status(400).json({ message: "Already punched in today", record });
    }

    // Create empty row if first punch of the day
    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    // 6) Write punch-in fields
    record.punchIn = now;
    record.punchInSource = source;
    record.punchInLocation = location; // { latitude, longitude, address }
    record.shift = shiftDbId(shift); // real shift id or null (default)
    record.status = "Pending"; // waiting for punch-out
    record.workedMinutes = 0;
    if (req.body.remarks) record.remarks = req.body.remarks;
    await record.save();

    // 7) Populate for response
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
      shift: shiftSummary(shift), // assigned or default timings
      location,
      record,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUNCH OUT — POST /api/attendance/punch-out
 * Must punch-in first. Then out + day metrics (Present / HD / late…).
 */
const   punchOut = async (req, res) => {
  try {
    // 1) Self source only
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();

    // 2) Must have today's punch-in
    const record = await Attendance.findOne({ employee: employeeId, date });
    if (!record || !record.punchIn) {
      return res.status(400).json({ message: "Please punch in first" });
    }
    // Already out → block
    if (record.punchOut) {
      return res.status(400).json({ message: "Already punched out today", record });
    }

    // 3) Live shift (assignment update applies) or default
    const { shift } = await getAssignedShift(employeeId, date);
    record.shift = shiftDbId(shift) || record.shift; // keep id if assigned

    // 4) Out window check (late out usually allowed)
    const windowCheck = validatePunchAgainstShift(shift, now, "out", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    // 5) Geo for out
    const location = await resolvePunchLocation(req.body);

    // 6) Save out + compute Present/HalfDay/late/early
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
 * Admin/HR/Manager sets In or Out with HH:mm + reason (audit).
 */
const markManual = async (req, res) => {
  try {
    // Only privileged roles
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({
        message: "Only Super Admin / HR Manager / Manager can mark attendance manually",
      });
    }

    const { employeeId, punchType, time, reason, remarks } = req.body;
    const date = today();

    // Target employee must exist + Active
    const employee = await User.findById(employeeId).select(
      "_id name status official.company"
    );
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "Active") {
      return res.status(400).json({ message: "Employee is inactive" });
    }

    // Company-scoped admin cannot mark other company
    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertSameCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    // Combine today's date + given time
    const punchAt = combineDateTime(date, time);
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    // Same shift resolve as self punch
    const { shift } = await getAssignedShift(employeeId, date);
    const dbShiftId = shiftDbId(shift);
    if (dbShiftId) record.shift = dbShiftId;

    if (punchType === "in") {
      // Manual punch-in
      record.punchIn = punchAt;
      record.punchInSource = "manual";
      record.status = record.punchOut ? record.status : "Pending";
    } else {
      // Manual punch-out — needs existing in
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

    record.reason = reason; // required audit reason
    record.remarks = remarks || "";
    record.markedBy = req.user._id; // who marked
    applyMetrics(record, shift); // status / late / early
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

/**
 * MY TODAY — GET /api/attendance/today
 * Returns today's record + current shift (assigned or default summary)
 */
const myToday = async (req, res) => {
  try {
    const date = today();
    // Load today's attendance if any
    let record = await Attendance.findOne({
      employee: req.user._id,
      date,
    }).populate("shift");

    // Always resolve live shift (assignment OR default)
    const { shift } = await getAssignedShift(req.user._id, date);

    if (record) {
      let dirty = false; // need save?
      const dbId = shiftDbId(shift);
      // If assignment exists, keep attendance.shift in sync
      if (dbId) {
        const recordShiftId = record.shift
          ? String(record.shift._id || record.shift)
          : null;
        if (recordShiftId !== String(dbId)) {
          record.shift = dbId;
          dirty = true;
        }
      }
      // Both punches + still Pending → recompute status
      if (record.punchIn && record.punchOut && (dirty || record.status === "Pending")) {
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
      shift: shiftSummary(shift), // one object: assigned or default
      record: record || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Who can see which employees in list APIs
 * Employee → only self; Admin → company / all / filter by employeeId
 */
const buildEmployeeScope = async (req) => {
  if (!hasAllAccess(req.user)) {
    return { employee: req.user._id }; // ESS: own rows only
  }
  if (req.query.employeeId) {
    return { employee: req.query.employeeId }; // filter one employee
  }
  if (!hasGlobalCompanyAccess(req.user)) {
    const scope = companyFilter(req.user);
    if (scope === false) {
      return { error: "Your profile has no company — cannot list attendance" };
    }
    if (scope) {
      // All users in same company
      const companyUsers = await User.find(scope).select("_id").lean();
      return { employee: { $in: companyUsers.map((u) => u._id) } };
    }
  }
  return {}; // global: no employee filter
};

/** Map UI mode aliases → punch source stored in DB */
const normalizeMode = (modeOrSource) => {
  if (!modeOrSource) return null;
  const m = String(modeOrSource).trim().toLowerCase();
  if (["face", "biometric"].includes(m)) return "biometric";
  if (["location", "web"].includes(m)) return "web";
  if (["mobile"].includes(m)) return "mobile";
  if (["manual"].includes(m)) return "manual";
  if (["web", "mobile", "biometric", "manual"].includes(m)) return m;
  return null;
};

/**
 * Resolve employee ids for search / department filters (before attendance query)
 */
const findEmployeeIdsForFilters = async ({
  search,
  department,
  baseEmployeeFilter,
}) => {
  const userFilter = { role: "Employee" };
  if (baseEmployeeFilter?.employee) {
    if (baseEmployeeFilter.employee.$in) {
      userFilter._id = { $in: baseEmployeeFilter.employee.$in };
    } else {
      userFilter._id = baseEmployeeFilter.employee;
    }
  }
  if (department) {
    userFilter["official.department"] = new RegExp(
      `^${String(department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );
  }
  if (search) {
    const q = String(search).trim();
    userFilter.$or = [
      { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      {
        "official.employeeCode": new RegExp(
          q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        ),
      },
      {
        "official.officialEmail": new RegExp(
          q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        ),
      },
    ];
  }
  if (!search && !department) return null; // no extra user filter
  const users = await User.find(userFilter).select("_id").lean();
  return users.map((u) => u._id);
};

/** Apply Daily Attendance status tab logic onto Mongo filter */
const applyStatusFilter = (filter, status) => {
  if (!status || status === "ALL") return;
  const s = String(status);
  if (s === "Late") {
    // Late arrival: has late minutes
    filter.lateByMinutes = { $gt: 0 };
    return;
  }
  if (s === "Working") {
    // Punched in, not out yet
    filter.punchIn = { $ne: null };
    filter.punchOut = null;
    filter.status = "Pending";
    return;
  }
  if (s === "OnLeave") {
    filter.status = "OnLeave";
    return;
  }
  if (s === "WFH") {
    filter.status = "WFH";
    return;
  }
  if (s === "HalfDay") {
    filter.status = "HalfDay";
    return;
  }
  filter.status = s;
};

/**
 * LIST — GET /api/attendance  (Daily Attendance admin UI)
 *
 * Filters (query):
 *   date | from+to
 *   search, department, location, shiftId
 *   mode | source
 *   status: ALL|Present|Absent|Late|Working|HalfDay|OnLeave|WFH|…
 *   employeeId, page, limit
 *
 * Also returns summary counts for status tabs (same date/scope, ignore status tab).
 */
const listAttendance = async (req, res) => {
  try {
    const scope = await buildEmployeeScope(req);
    if (scope.error) return res.status(403).json({ message: scope.error });

    const {
      date,
      from,
      to,
      search,
      department,
      location,
      shiftId,
      mode,
      source,
      status,
      page,
      limit,
    } = req.query;

    // Base filter from company / employeeId scope
    const filter = { ...scope };

    // Date: single day (Daily Attendance) OR range
    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    // Search / department → employee id list
    const empIds = await findEmployeeIdsForFilters({
      search,
      department,
      baseEmployeeFilter: scope,
    });
    if (empIds) {
      if (empIds.length === 0) {
        return res.json({
          total: 0,
          page,
          limit,
          pages: 1,
          count: 0,
          summary: {
            all: 0,
            present: 0,
            absent: 0,
            late: 0,
            onLeave: 0,
            wfh: 0,
            halfDay: 0,
            working: 0,
          },
          filters: {
            date: date || null,
            from: from || null,
            to: to || null,
            search: search || "",
            department: department || "",
            location: location || "",
            shiftId: shiftId || null,
            mode: mode || source || "",
            status: status || "ALL",
          },
          records: [],
        });
      }
      filter.employee = { $in: empIds };
    }

    if (shiftId) filter.shift = shiftId;

    // Mode / source (UI: Face, Location, Biometric, Manual, Mobile)
    const punchSource = normalizeMode(mode) || source || null;
    if (punchSource) {
      filter.$or = [
        { punchInSource: punchSource },
        { punchOutSource: punchSource },
      ];
    }

    // Location text match on saved addresses
    if (location) {
      const locRe = new RegExp(
        String(location).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const locOr = [
        { "punchInLocation.address": locRe },
        { "punchOutLocation.address": locRe },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: locOr }];
        delete filter.$or;
      } else {
        filter.$or = locOr;
      }
    }

    // Status tab (may mutate filter)
    applyStatusFilter(filter, status);

    const skip = (page - 1) * limit;

    // Summary counts: same scope/date/dept/search/shift/mode — ignore status tab
    const summaryFilter = { ...scope };
    if (date) summaryFilter.date = date;
    else if (from || to) {
      summaryFilter.date = {};
      if (from) summaryFilter.date.$gte = from;
      if (to) summaryFilter.date.$lte = to;
    }
    if (empIds) summaryFilter.employee = { $in: empIds };
    if (shiftId) summaryFilter.shift = shiftId;
    if (punchSource) {
      summaryFilter.$or = [
        { punchInSource: punchSource },
        { punchOutSource: punchSource },
      ];
    }
    if (location) {
      const locRe = new RegExp(
        String(location).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const locOr = [
        { "punchInLocation.address": locRe },
        { "punchOutLocation.address": locRe },
      ];
      if (summaryFilter.$or) {
        summaryFilter.$and = [{ $or: summaryFilter.$or }, { $or: locOr }];
        delete summaryFilter.$or;
      } else {
        summaryFilter.$or = locOr;
      }
    }

    const [
      total,
      records,
      present,
      absent,
      late,
      halfDay,
      working,
      onLeave,
      wfh,
      allCount,
    ] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter)
        .populate(
          "employee",
          "name role official.officialEmail official.employeeCode official.department official.company"
        )
        .populate("markedBy", "name role")
        .populate("shift", "code name startTime endTime punchStartTime")
        .sort({ date: -1, punchIn: -1 })
        .skip(skip)
        .limit(limit),
      Attendance.countDocuments({ ...summaryFilter, status: "Present" }),
      Attendance.countDocuments({ ...summaryFilter, status: "Absent" }),
      Attendance.countDocuments({
        ...summaryFilter,
        lateByMinutes: { $gt: 0 },
      }),
      Attendance.countDocuments({ ...summaryFilter, status: "HalfDay" }),
      Attendance.countDocuments({
        ...summaryFilter,
        status: "Pending",
        punchIn: { $ne: null },
        punchOut: null,
      }),
      Attendance.countDocuments({ ...summaryFilter, status: "OnLeave" }),
      Attendance.countDocuments({ ...summaryFilter, status: "WFH" }),
      Attendance.countDocuments(summaryFilter),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      count: records.length,
      /** Status tab badges (Daily Attendance UI) */
      summary: {
        all: allCount,
        present,
        absent,
        late,
        onLeave,
        wfh,
        halfDay,
        working,
      },
      filters: {
        date: date || null,
        from: from || null,
        to: to || null,
        search: search || "",
        department: department || "",
        location: location || "",
        shiftId: shiftId || null,
        mode: mode || source || "",
        status: status || "ALL",
      },
      records,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MY WEB PUNCHES — GET /api/attendance/web-punches
 * Flattens each day into separate IN / OUT rows (for ESS table UI)
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

    // One attendance day → up to 2 punch rows (IN + OUT)
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

    // Newest punch first
    punches.sort((a, b) => new Date(b.punchTime) - new Date(a.punchTime));

    // Manual pagination on flattened list
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
 * Past days: has punch-in, no punch-out → force status Absent
 */
const closeAbsent = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const before = today(); // only days before today
    const filter = {
      date: { $lt: before },
      punchIn: { $ne: null }, // punched in
      punchOut: null, // never out
      status: { $nin: ["Absent"] }, // not already Absent
    };

    // Optional filters / company scope
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

// Export handlers used by attendance.routes.js
module.exports = {
  punchIn,
  punchOut,
  markManual,
  myToday,
  listAttendance,
  listWebPunches,
  closeAbsent,
};
