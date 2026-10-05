/**
 * ATTENDANCE CONTROLLER — APIs under /api/attendance
 *
 * Punch flow (simple):
 * 1. Body: source + latitude + longitude (address NOT from client)
 * 2. Default work window 10:00–19:00 (grace 10)
 * 3. validatePunchAgainstShift → time window OK?
 * 4. Map API → address from lat/long
 * 5. Save Attendance (one row per employee per day)
 */
const Attendance = require("../models/Attendance"); // daily punch document
const User = require("../models/User"); // employee lookup (manual / scope)
const { hasAllAccess } = require("../middleware/auth"); // admin/HR/manager roles
const {
  hasGlobalCompanyAccess, // Super Admin / Admin?
  companyNamesForUser,
} = require("../utils/companyScope");
const { listScopeFilter, assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const { SELF_SOURCES } = require("../validators/attendance.validation"); // web|mobile|biometric
const { resolvePunchLocation } = require("../utils/geocode"); // lat/long → address
const {
  todayDate, // YYYY-MM-DD in app TZ
  getAssignedShift, // default 10:00–19:00
  validatePunchAgainstShift, // punch time gatekeeper
  computeDayMetrics, // Present / Absent / late / early
} = require("../utils/shiftTiming");
const {
  enrichAttendanceRow,
  enrichMany,
  formatDisplayDate,
} = require("../utils/attendanceView");
const {
  listAttendanceMasterNames,
} = require("../utils/attendanceMasters");
const { ATTENDANCE_DROPDOWNS } = require("../config/generalInfoMasters");

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

    // 2) Default work window (Shift module removed)
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
 * MANUAL META — GET /api/attendance/manual/meta
 * Reason dropdown for Mark Attendance modal (Master type=markAttendanceReason)
 */
const getManualMarkMeta = async (req, res) => {
  try {
    const reasons = await listAttendanceMasterNames(
      "markAttendanceReason",
      req.user
    );
    return res.json({
      punchTypes: ["in", "out"],
      reasons: reasons.length
        ? reasons
        : [...ATTENDANCE_DROPDOWNS.markAttendanceReason],
      reasonMasterType: "markAttendanceReason",
      today: todayDate(),
      note: "Reasons from Masters → type=markAttendanceReason (GET /api/masters?type=markAttendanceReason)",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MANUAL MARK — POST /api/attendance/manual
 * Admin/HR/Manager sets In or Out with HH:mm + reason (audit).
 * Body: employeeId, punchType, time, reason, date?, remarks?
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
    const date = req.body.date || today();

    // Target employee must exist + Active
    const employee = await User.findById(employeeId).select(
      "_id name status official.companyIds"
    );
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (employee.status !== "Active") {
      return res.status(400).json({ message: "Employee is inactive" });
    }

    // Company-scoped admin cannot mark other company
    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
      const scopeErr = assertTeamOrCompanyEmployee(req.user, employee);
      if (scopeErr) {
        return res.status(403).json({ message: scopeErr });
      }
    }

    // Combine date + given time
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

    record.reason = reason; // required audit reason (from markAttendanceReason master)
    record.remarks = remarks || "";
    record.markedBy = req.user._id; // who marked
    applyMetrics(record, shift); // status / late / early
    await record.save();

    await record.populate(
      "employee",
      "name role official.officialEmail official.employeeCode official.department official.companyIds"
    );
    await record.populate("markedBy", "name role");

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
    });

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
    const scope = listScopeFilter(req.user);
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
 *   search, department, location
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
            mode: mode || source || "",
            status: status || "ALL",
          },
          records: [],
        });
      }
      filter.employee = { $in: empIds };
    }

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

    // Summary counts: same scope/date/dept/search/mode — ignore status tab
    const summaryFilter = { ...scope };
    if (date) summaryFilter.date = date;
    else if (from || to) {
      summaryFilter.date = {};
      if (from) summaryFilter.date.$gte = from;
      if (to) summaryFilter.date.$lte = to;
    }
    if (empIds) summaryFilter.employee = { $in: empIds };
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
          "name role official.officialEmail official.employeeCode official.department official.companyIds"
        )
        .populate("markedBy", "name role")
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

    // Enrich for Daily Attendance table (display times, hours, badges)
    const enriched = await enrichMany(records.map((r) => r.toObject()));

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      count: enriched.length,
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
        mode: mode || source || "",
        status: status || "ALL",
      },
      records: enriched,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DETAIL — GET /api/attendance/details/:id
 * OR GET /api/attendance/details?employeeId=&date=
 * Side panel: punch timeline, work info, summary, verification
 */
const getAttendanceDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, date } = req.query;

    let record = null;
    if (id) {
      record = await Attendance.findById(id)
        .populate(
          "employee",
          "name role personal.presentAddress personal.permanentAddress official.officialEmail official.employeeCode official.department official.companyIds"
        )
        .populate("markedBy", "name role")
        .lean();
    } else if (employeeId && date) {
      record = await Attendance.findOne({ employee: employeeId, date })
        .populate(
          "employee",
          "name role personal.presentAddress personal.permanentAddress official.officialEmail official.employeeCode official.department official.companyIds"
        )
        .populate("markedBy", "name role")
        .lean();
    } else {
      return res.status(400).json({
        message: "Provide attendance id OR employeeId + date",
      });
    }

    if (!record) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    // ESS can only view own; admin company-scoped
    if (!hasAllAccess(req.user)) {
      if (String(record.employee?._id || record.employee) !== String(req.user._id)) {
        return res.status(403).json({ message: "Forbidden" });
      }
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const err = assertTeamOrCompanyEmployee(req.user, record.employee);
      if (err) return res.status(403).json({ message: err });
    }

    const details = await enrichAttendanceRow(record, { includeDetails: true });

    return res.json({
      message: "Attendance details",
      data: details,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * CALENDAR — GET /api/attendance/calendar?month=YYYY-MM&date=YYYY-MM-DD
 *
 * UI (Attendance Calendar):
 *  - Left: month day dots + selected-day summary (Present / Absent / Late / On Leave)
 *  - Main: ALL active employees for selected day (no punch → Absent / WO / Holiday)
 *
 * Empty punches on a day no longer returns empty employees[].
 */
const getAttendanceCalendar = async (req, res) => {
  try {
    const scope = await buildEmployeeScope(req);
    if (scope.error) return res.status(403).json({ message: scope.error });

    const {
      month,
      date: selectedDate,
      search,
      department,
      status,
      page = 1,
      limit = 50,
    } = req.query;

    const today = todayDate();
    const monthKey = month || (selectedDate || today).slice(0, 7);
    const [y, m] = monthKey.split("-").map(Number);
    const monthFrom = `${monthKey}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthTo = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

    // Prefer explicit date; fall back to today if in month, else 1st
    let day = selectedDate || null;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !day.startsWith(monthKey)) {
      day = today.startsWith(monthKey) ? today : monthFrom;
    }

    // ── Active employee roster (UI shows everyone, not only punched) ─────────
    const userFilter = { status: "Active", role: "Employee" };
    if (scope.employee) {
      if (scope.employee.$in) userFilter._id = { $in: scope.employee.$in };
      else userFilter._id = scope.employee;
    }
    if (department) {
      userFilter["official.department"] = new RegExp(
        `^${String(department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }
    if (search) {
      const q = String(search).trim();
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      userFilter.$or = [
        { name: re },
        { "official.employeeCode": re },
        { "official.officialEmail": re },
      ];
    }

    const roster = await User.find(userFilter)
      .select(
        "name role personal.presentAddress personal.permanentAddress official.officialEmail official.employeeCode official.department official.companyIds"
      )
      .sort({ name: 1 })
      .lean();

    const rosterIds = roster.map((u) => u._id);

    // Month attendance for these employees only (ignore non-roster roles)
    const monthRows =
      rosterIds.length === 0
        ? []
        : await Attendance.find({
            employee: { $in: rosterIds },
            date: { $gte: monthFrom, $lte: monthTo },
          })
            .lean();

    // Index: date → employeeId → record
    const byDateEmp = {};
    const byDate = {};
    const rosterIdSet = new Set(rosterIds.map(String));

    for (const r of monthRows) {
      const empKey = String(r.employee?._id || r.employee);
      if (!rosterIdSet.has(empKey)) continue;

      if (!byDate[r.date]) {
        byDate[r.date] = {
          date: r.date,
          present: 0,
          absent: 0,
          late: 0,
          onLeave: 0,
          working: 0,
          halfDay: 0,
          wfh: 0,
          weeklyOff: 0,
          holiday: 0,
          all: 0,
        };
      }
      const bucket = byDate[r.date];
      bucket.all += 1;

      // Resolve display status (DB may be empty / Pending)
      let st = r.status;
      if (!st || st === "Pending") {
        if (r.punchIn && r.punchOut) st = "Present";
        else if (r.punchIn && !r.punchOut) st = "Working";
        else st = "Absent";
      }

      if (st === "Present") bucket.present += 1;
      else if (st === "Absent") bucket.absent += 1;
      else if (st === "OnLeave") bucket.onLeave += 1;
      else if (st === "HalfDay") bucket.halfDay += 1;
      else if (st === "WFH") bucket.wfh += 1;
      else if (st === "WeeklyOff") bucket.weeklyOff += 1;
      else if (st === "Holiday") bucket.holiday += 1;
      else if (st === "Working") bucket.working += 1;
      if (Number(r.lateByMinutes) > 0) bucket.late += 1;

      if (!byDateEmp[r.date]) byDateEmp[r.date] = {};
      byDateEmp[r.date][empKey] = r;
    }

    // Fill missing roster employees as Absent for each day that has ANY punch
    // (keeps month dots honest); selected day always uses full roster below.
    const calendar = [];
    for (let d = 1; d <= lastDay; d++) {
      const ds = `${monthKey}-${String(d).padStart(2, "0")}`;
      const bucket = byDate[ds] || {
        date: ds,
        present: 0,
        absent: 0,
        late: 0,
        onLeave: 0,
        working: 0,
        halfDay: 0,
        wfh: 0,
        weeklyOff: 0,
        holiday: 0,
        all: 0,
      };
      // Days with some punches: un-punched roster members count as absent
      if (bucket.all > 0 && rosterIds.length > bucket.all) {
        const missing = rosterIds.length - bucket.all;
        bucket.absent += missing;
        bucket.all = rosterIds.length;
      }
      calendar.push(bucket);
    }

    // ── Selected day: full roster rows ───────────────────────────────────────
    const dayMap = byDateEmp[day] || {};
    const dayRows = [];
    for (const emp of roster) {
      const existing = dayMap[String(emp._id)];
      if (existing) {
        dayRows.push({
          ...existing,
          employee: emp,
        });
      } else {
        // No punch → resolve shift day-type (Absent / WeeklyOff / Holiday)
        const { shift } = await getAssignedShift(emp._id, day);
        const metrics = computeDayMetrics(null, shift, day);
        dayRows.push({
          _id: null,
          employee: emp,
          date: day,
          shift: shift?.isDefault ? null : shift,
          punchIn: null,
          punchOut: null,
          punchInSource: null,
          punchOutSource: null,
          status: metrics.status,
          workedMinutes: 0,
          lateByMinutes: 0,
          earlyByMinutes: 0,
          workMode: "WFO",
          breaks: [],
          reason: "",
          remarks: "",
          _synthetic: true,
          _shiftResolved: shift,
        });
      }
    }

    // Enrich all day rows (pass resolved shift via record.shift when possible)
    const enrichedAll = [];
    for (const row of dayRows) {
      if (row._synthetic && row._shiftResolved) {
        // Temporarily attach shift object for enrich
        row.shift = row._shiftResolved;
      }
      const enriched = await enrichAttendanceRow(row, { includeDetails: false });
      // Late badge for UI when late minutes > 0 on Present/HalfDay
      if (
        enriched.lateByMinutes > 0 &&
        ["Present", "HalfDay"].includes(enriched.status)
      ) {
        enriched.statusBadge = "Late";
      } else {
        enriched.statusBadge = enriched.status;
      }
      enrichedAll.push(enriched);
    }

    // Status tab filter on enriched roster
    const statusKey = status && status !== "ALL" ? String(status) : null;
    let filtered = enrichedAll;
    if (statusKey) {
      filtered = enrichedAll.filter((r) => {
        if (statusKey === "Late") return r.lateByMinutes > 0;
        if (statusKey === "Working") return r.status === "Working";
        if (statusKey === "Present")
          return r.status === "Present" || r.dbStatus === "Present";
        return (
          r.status === statusKey ||
          r.dbStatus === statusKey ||
          r.statusBadge === statusKey
        );
      });
    }

    // Summary for selected day = full roster (ignore status tab, match UI cards)
    const summary = {
      present: 0,
      absent: 0,
      late: 0,
      onLeave: 0,
      working: 0,
      halfDay: 0,
      wfh: 0,
      weeklyOff: 0,
      holiday: 0,
      all: enrichedAll.length,
    };
    for (const r of enrichedAll) {
      if (r.status === "Present" || r.dbStatus === "Present") summary.present += 1;
      else if (r.status === "Absent" || r.dbStatus === "Absent") summary.absent += 1;
      else if (r.status === "OnLeave" || r.dbStatus === "OnLeave") summary.onLeave += 1;
      else if (r.status === "Working") summary.working += 1;
      else if (r.status === "HalfDay" || r.dbStatus === "HalfDay") summary.halfDay += 1;
      else if (r.status === "WFH" || r.dbStatus === "WFH") summary.wfh += 1;
      else if (r.status === "WeeklyOff" || r.dbStatus === "WeeklyOff")
        summary.weeklyOff += 1;
      else if (r.status === "Holiday" || r.dbStatus === "Holiday")
        summary.holiday += 1;
      if (r.lateByMinutes > 0) summary.late += 1;
    }

    // Paginate filtered list
    const p = Number(page) || 1;
    const l = Number(limit) || 50;
    const total = filtered.length;
    const skip = (p - 1) * l;
    const employees = filtered.slice(skip, skip + l);

    return res.json({
      month: monthKey,
      selectedDate: day,
      displayDate: formatDisplayDate(day),
      calendar,
      summary,
      total,
      page: p,
      limit: l,
      pages: Math.max(1, Math.ceil(total / l) || 1),
      count: employees.length,
      employeesShown: total,
      employees,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * LATE & EARLY — GET /api/attendance/late-early
 * Query: type=late|early|all, date|from+to, search, department, page, limit
 */
const listLateEarly = async (req, res) => {
  try {
    const scope = await buildEmployeeScope(req);
    if (scope.error) return res.status(403).json({ message: scope.error });

    const {
      type = "late",
      date,
      from,
      to,
      search,
      department,
      page = 1,
      limit = 10,
    } = req.query;

    const filter = { ...scope };

    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const empIds = await findEmployeeIdsForFilters({
      search,
      department,
      baseEmployeeFilter: scope,
    });
    if (empIds) {
      if (empIds.length === 0) {
        return res.json({
          total: 0,
          page: Number(page),
          limit: Number(limit),
          pages: 1,
          type,
          data: [],
        });
      }
      filter.employee = { $in: empIds };
    }

    const t = String(type).toLowerCase();
    if (t === "late") filter.lateByMinutes = { $gt: 0 };
    else if (t === "early") filter.earlyByMinutes = { $gt: 0 };
    else {
      filter.$or = [
        { lateByMinutes: { $gt: 0 } },
        { earlyByMinutes: { $gt: 0 } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [total, records] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter)
        .populate(
          "employee",
          "name role personal.presentAddress personal.permanentAddress official.officialEmail official.employeeCode official.department official.companyIds"
        )
        .sort({ date: -1, lateByMinutes: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    const enriched = await enrichMany(records);
    const data = enriched.map((r) => ({
      ...r,
      status:
        t === "early" || (r.earlyByMinutes > 0 && !(r.lateByMinutes > 0))
          ? "Early Exit"
          : "Late",
    }));

    return res.json({
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.max(1, Math.ceil(total / Number(limit))),
      type: t,
      data,
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
      const scope = listScopeFilter(req.user);
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

/**
 * HISTORY / WEEK VIEW — GET /api/attendance/history?employeeId=&date=
 * Daily Attendance side panel "View History": week strip (P/A/L/WFH/H) + daily logs
 */
const getAttendanceHistory = async (req, res) => {
  try {
    let employeeId = req.query.employeeId || req.user._id;
    if (
      String(employeeId) !== String(req.user._id) &&
      !hasAllAccess(req.user)
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const emp = await User.findById(employeeId).select(
      "name role personal.presentAddress personal.permanentAddress official.officialEmail official.employeeCode official.department official.companyIds status"
    );
    if (!emp) return res.status(404).json({ message: "Employee not found" });

    if (hasAllAccess(req.user) && !hasGlobalCompanyAccess(req.user)) {
      const err = assertTeamOrCompanyEmployee(req.user, emp);
      if (err) return res.status(403).json({ message: err });
    }

    const anchor = req.query.date || todayDate();
    let from = req.query.from;
    let to = req.query.to;

    // Default: Mon–Sun week containing anchor date
    if (!from || !to) {
      const d = new Date(`${anchor}T12:00:00`);
      const day = d.getDay(); // 0 Sun
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (x) => x.toISOString().slice(0, 10);
      from = from || fmt(monday);
      to = to || fmt(sunday);
    }

    const dates = [];
    {
      let cur = from;
      while (cur <= to) {
        dates.push(cur);
        const n = new Date(`${cur}T12:00:00`);
        n.setDate(n.getDate() + 1);
        cur = n.toISOString().slice(0, 10);
      }
    }

    const records = await Attendance.find({
      employee: employeeId,
      date: { $gte: from, $lte: to },
    })
      .lean();
    const map = {};
    for (const r of records) map[r.date] = r;

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const week = [];
    const logs = [];

    for (const date of dates) {
      const record = map[date] || {
        employee: emp.toObject ? emp.toObject() : emp,
        date,
        punchIn: null,
        punchOut: null,
        status: null,
        workedMinutes: 0,
        lateByMinutes: 0,
      };
      if (!record.employee || !record.employee.name) {
        record.employee = emp.toObject ? emp.toObject() : emp;
      }
      const enriched = await enrichAttendanceRow(record);
      let code = "A";
      const st = enriched.statusBadge || enriched.status;
      if (st === "Present") code = enriched.lateByMinutes > 0 ? "L" : "P";
      else if (st === "Late") code = "L";
      else if (st === "Absent") code = "A";
      else if (st === "WFH") code = "WFH";
      else if (st === "Holiday") code = "H";
      else if (st === "WeeklyOff") code = "WO";
      else if (st === "HalfDay") code = "HD";
      else if (st === "OnLeave") code = "CL";
      else if (st === "Working") code = "W";

      const wd = new Date(`${date}T12:00:00`).getDay();
      week.push({
        date,
        day: DAY_NAMES[wd],
        displayDate: enriched.displayDate,
        code,
        status: enriched.status,
        statusBadge: enriched.statusBadge,
      });
      logs.push({
        date,
        day: DAY_NAMES[wd],
        displayDate: enriched.displayDate,
        status: enriched.status,
        statusBadge: enriched.statusBadge,
        code,
        punchInDisplay: enriched.punchInDisplay,
        punchOutDisplay: enriched.punchOutDisplay,
        workingHours: enriched.workingHours,
        workedMinutes: enriched.workedMinutes,
        lateByDisplay: enriched.lateByDisplay,
        verification: enriched.verification,
      });
    }

    return res.json({
      employee: {
        _id: emp._id,
        name: emp.name,
        employeeCode: emp.official?.employeeCode || "",
        department: emp.official?.department || "",
        company: (await companyNamesForUser(emp))[0] || "",
      },
      from,
      to,
      selectedDate: anchor,
      week,
      logs,
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
  getAttendanceDetails,
  getAttendanceCalendar,
  listLateEarly,
  getAttendanceHistory,
  getManualMarkMeta,
};
