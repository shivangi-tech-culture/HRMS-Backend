/**
 * ATTENDANCE CONTROLLER — /api/attendance
 *
 * Self (any login):     punch-in · punch-out · today · web-punches
 * Admin / HR / Super:   daily · calendar · remark approve/reject
 *
 * SAFETY — company / employee assignment:
 * - This file NEVER updates User.official.companyIds / branchId / shiftId
 * - Placement is READ via getAssignedShift → attendancePlacement.js
 * - Snapshots (companyId/branchId/shift) are saved only on Attendance docs
 * - Employee create/update still uses companyShift.assertUserPlacement only
 */
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const { SELF_SOURCES } = require("../validators/attendance.validation");
const { resolvePunchLocation } = require("../utils/geocode");
const {
  todayDate,
  getAssignedShift, // attendance-only read of company/branch/shift
  validatePunchAgainstShift,
  computeDayMetrics,
  overtimeMinutesOf,
  formatPunchStamp,
  dayScheduleOf,
  lateByMinutesOf,
  DEFAULT_SHIFT,
} = require("../utils/shiftTiming");
const {
  shiftSummary,
  companySummary,
  branchSummary,
  shiftDbId,
  formatAttendanceRecord,
  formatDurationLabel,
  oid,
} = require("../utils/attendanceFormat");
const {
  companyFilter,
  hasGlobalCompanyAccess,
  userCompanyIds,
  managementCompanyIds,
} = require("../utils/companyScope");
const {
  teamMemberFilter,
  assertTeamOrCompanyEmployee,
} = require("../utils/teamScope");
const {
  normalizeRoleName,
  EMPLOYEE,
  isTeamScopedRole,
} = require("../config/roles");

/**
 * Who can approve/reject attendance remarks:
 *   Super Admin / Admin → ALL companies (platform)
 *   HR Manager          → EVERY company in official.companyIds (1 or many)
 *   Reporting Manager   → their team only
 */
const reviewerScopeOf = (actor) => {
  if (hasGlobalCompanyAccess(actor)) return "all";
  if (isTeamScopedRole(normalizeRoleName(actor?.role))) return "team";
  // HR (and similar): all assigned companies, not just the first one
  return "assigned_companies";
};

const today = todayDate;

/** Self punch source must be web / mobile / biometric (not manual) */
const assertSelfSource = (source) => {
  if (!SELF_SOURCES.includes(source)) {
    return "Self punch source must be web, mobile, or biometric. Manual is admin-only.";
  }
  return null;
};

/**
 * Copy day metrics onto Attendance row after punch-out.
 * holdForRemark=true → keep status Pending until admin approve/reject.
 */
const applyMetrics = (record, shift, { holdForRemark = false } = {}) => {
  const metrics = computeDayMetrics(record, shift, record.date);
  record.workedMinutes = metrics.workedMinutes;
  record.overtimeMinutes =
    metrics.overtimeMinutes ?? overtimeMinutesOf(metrics.workedMinutes);
  record.lateByMinutes = metrics.lateByMinutes;
  record.earlyByMinutes = metrics.earlyByMinutes;
  // Remark pending → admin decides Present/Absent later
  record.status = holdForRemark ? "Pending" : metrics.status;
  return metrics;
};

/**
 * Save company/branch/shift SNAPSHOT on Attendance only.
 * Does NOT write to User.official (assignment stays as-is).
 */
const applyPlacement = (record, { company, branch, shift }) => {
  record.shift = shiftDbId(shift) || record.shift || null;
  if (company?._id) record.companyId = company._id;
  if (branch?._id) record.branchId = branch._id;
};

/** Extras passed into formatAttendanceRecord for punch responses */
const punchExtras = ({ company, branch, shift }) => ({
  company: companySummary(company),
  branch: branchSummary(branch),
  shift: shiftSummary(shift),
});

const remarkText = (body) => String(body?.remarks ?? "").trim();

/** Non-empty note → remarkStatus Pending (admin can approve/reject) */
const applyRemarkOnPunch = (record, text) => {
  if (!text) return;
  record.remarks = text;
  if (record.remarkStatus !== "Approved" && record.remarkStatus !== "Rejected") {
    record.remarkStatus = "Pending";
  }
};

/** Punch-in / punch-out. Company, branch, shift, location and remarks live only on record. */
const punchPayload = (message, { company, branch, shift, record }) => ({
  message,
  record: formatAttendanceRecord(record, punchExtras({ company, branch, shift })),
});

/**
 * PUNCH IN — POST /api/attendance/punch-in
 * Body: { source, latitude, longitude, remarks? }
 * Reads assignment for display only — never changes User company/branch/shift.
 */
const punchIn = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();
    const remarks = remarkText(req.body);

    const { shift, company, branch } = await getAssignedShift(employeeId, date);
    if (!company?._id || !branch?._id || !shift?._id) {
      return res.status(400).json({
        message:
          "Company, branch and shift are not assigned on your profile. Punch-in uses that workplace.",
      });
    }

    const windowCheck = validatePunchAgainstShift(shift, now, "in", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    const location = await resolvePunchLocation(req.body);

    let record = await Attendance.findOne({ employee: employeeId, date });
    if (record && record.punchIn) {
      await record.populate(
        "employee",
        "name role official.employeeCode official.officialEmail official.department official.designation"
      );
      return res.status(400).json({
        message: "Already punched in today",
        record: formatAttendanceRecord(record, punchExtras({ company, branch, shift })),
      });
    }

    if (!record) {
      record = new Attendance({ employee: employeeId, date });
    }

    record.punchIn = now;
    record.punchInSource = source;
    record.punchInLocation = location;
    applyPlacement(record, { company, branch, shift });
    record.status = "Pending";
    record.workedMinutes = 0;
    record.overtimeMinutes = 0;
    applyRemarkOnPunch(record, remarks);
    // Late vs that day's shift → Late + Pending review until approve → Present
    if (windowCheck.isLate) {
      record.lateByMinutes = windowCheck.lateByMinutes || 0;
      record.status = "Late";
      record.remarkStatus = "Pending";
    }
    await record.save();

    await record.populate(
      "employee",
      "name role official.employeeCode official.department official.designation"
    );

    return res.status(201).json(
      punchPayload(
        windowCheck.isEarly
        ? "Punched in (early — before shift start, allowed)"
        : "Punched in successfully",
        { company, branch, shift, record }
      )
    );
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUNCH OUT — POST /api/attendance/punch-out
 * Computes Present/HalfDay + overtime (over 9h).
 * If remarks pending → status stays Pending for admin review.
 */
const punchOut = async (req, res) => {
  try {
    const sourceErr = assertSelfSource(req.body.source);
    if (sourceErr) return res.status(403).json({ message: sourceErr });

    const employeeId = req.user._id;
    const date = today();
    const source = req.body.source;
    const now = new Date();
    const remarks = remarkText(req.body);

    const record = await Attendance.findOne({ employee: employeeId, date });
    if (!record || !record.punchIn) {
      return res.status(400).json({ message: "Please punch in first" });
    }
    if (record.punchOut) {
      await record.populate(
        "employee",
        "name role official.employeeCode official.officialEmail official.department official.designation"
      );
      const placed = await getAssignedShift(employeeId, date);
      return res.status(400).json({
        message: "Already punched out today",
        record: formatAttendanceRecord(
          record,
          punchExtras({
            company: placed.company,
            branch: placed.branch,
            shift: placed.shift,
          })
        ),
      });
    }

    const { shift, company, branch } = await getAssignedShift(employeeId, date);
    applyPlacement(record, { company, branch, shift });

    const windowCheck = validatePunchAgainstShift(shift, now, "out", date);
    if (!windowCheck.ok) {
      return res.status(400).json({ message: windowCheck.message });
    }

    const location = await resolvePunchLocation(req.body);

    record.punchOut = now;
    record.punchOutSource = source;
    record.punchOutLocation = location;
    applyRemarkOnPunch(record, remarks);

    // Late punch or a remark stays Late/Pending until the review API approves it
    const holdForRemark = record.remarkStatus === "Pending";
    const wasLate =
      record.status === "Late" || (Number(record.lateByMinutes) || 0) > 0;
    applyMetrics(record, shift, { holdForRemark });
    if (holdForRemark && wasLate) record.status = "Late";
    await record.save();

    await record.populate(
      "employee",
      "name role official.employeeCode official.department official.designation"
    );

    return res.json(
      punchPayload(
        windowCheck.isLate
        ? "Punched out (after shift end — allowed)"
        : "Punched out successfully",
        { company, branch, shift, record }
      )
    );
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/today */
const myToday = async (req, res) => {
  try {
    const date = today();
    const empSelect =
      "name role official.employeeCode official.department official.designation";

    const [record, placed] = await Promise.all([
      Attendance.findOne({ employee: req.user._id, date }),
      getAssignedShift(req.user._id, date),
    ]);
    const { shift, company, branch } = placed;

    if (record) {
      let dirty = false;
      const dbId = shiftDbId(shift);
      if (dbId) {
        const recordShiftId = record.shift ? String(record.shift) : null;
        if (recordShiftId !== String(dbId)) {
          record.shift = dbId;
          dirty = true;
        }
      }
      applyPlacement(record, { company, branch, shift });
      if (record.punchIn && record.punchOut && (dirty || record.status === "Pending")) {
        const holdForRemark =
          Boolean(record.remarks) && record.remarkStatus === "Pending";
        if (!holdForRemark || dirty) {
          applyMetrics(record, shift, { holdForRemark });
          dirty = true;
        }
      }
      if (dirty) await record.save();
      await record.populate("employee", empSelect);
    }

    return res.json({
      date,
      company: companySummary(company),
      branch: branchSummary(branch),
      shift: shiftSummary(shift),
      record: formatAttendanceRecord(record, punchExtras({ company, branch, shift })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/attendance/web-punches — own punches flattened */
const listWebPunches = async (req, res) => {
  try {
    const filter = { employee: req.user._id };
    const { from, to, date, status, page, limit } = req.query;

    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (status && status !== "ALL") filter.status = status;

    const p = Math.max(Number(page) || 1, 1);
    const l = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const start = (p - 1) * l;

    const employee = {
      _id: req.user._id,
      name: req.user.name || "",
      official: { employeeCode: req.user.official?.employeeCode || "" },
    };

    // Own history only — lean select (no populate). Cap scan for safety.
    const records = await Attendance.find(filter)
      .select(
        "date status punchIn punchOut punchInSource punchOutSource punchInLocation punchOutLocation remarks remarkStatus"
      )
      .sort({ date: -1, punchIn: -1 })
      .limit(500)
      .lean();

    const punches = [];
    for (const r of records) {
      if (r.punchIn) {
        punches.push({
          _id: `${r._id}-in`,
          attendanceId: r._id,
          employee,
          status: r.status,
          punchTime: r.punchIn,
          punchMode: "IN",
          punchType: r.punchInSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchInLocation || {},
          remarks: r.remarks || "",
          remarkStatus: r.remarkStatus || null,
          source: r.punchInSource,
          date: r.date,
        });
      }
      if (r.punchOut) {
        punches.push({
          _id: `${r._id}-out`,
          attendanceId: r._id,
          employee,
          status: r.status,
          punchTime: r.punchOut,
          punchMode: "OUT",
          punchType: r.punchOutSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchOutLocation || {},
          remarks: r.remarks || "",
          remarkStatus: r.remarkStatus || null,
          source: r.punchOutSource,
          date: r.date,
        });
      }
    }

    punches.sort((a, b) => new Date(b.punchTime) - new Date(a.punchTime));
    const total = punches.length;

    return res.json({
      total,
      page: p,
      limit: l,
      pages: Math.max(1, Math.ceil(total / l)),
      data: punches.slice(start, start + l),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Which employees this admin/HR can see on daily/calendar.
 * Scope only — does not change any employee assignment fields.
 *
 * Super Admin / Admin → all employees
 * HR → employees in ANY of HR's official.companyIds (multi-company OK)
 * Reporting Manager → team members only
 */
const scopedEmployeeFilter = (actor) => {
  const base = {
    role: { $in: [EMPLOYEE, "Employee"] },
    status: { $ne: "Deleted" },
  };
  // Platform: no company filter
  if (hasGlobalCompanyAccess(actor)) return base;

  // Manager: team filter
  if (isTeamScopedRole(normalizeRoleName(actor.role))) {
    return { ...base, ...teamMemberFilter(actor) };
  }

  // HR: official.companyIds: { $in: [all assigned company ids] }
  const cf = companyFilter(actor);
  if (cf === false) return { _id: { $in: [] } };
  if (cf) Object.assign(base, cf);
  return base;
};

const ATTENDANCE_LIST_SELECT =
  "employee date companyId branchId shift punchIn punchOut punchInSource workMode workedMinutes overtimeMinutes lateByMinutes earlyByMinutes status remarks remarkStatus";

const EMPLOYEE_DAILY_SELECT =
  "name role status avatar official.employeeCode official.officialEmail official.department official.designation official.companyIds official.branchId official.shiftId personal.mobileNo";

/** Short TTL cache — company schedule rarely changes mid-request burst */
const companyBundleCache = new Map();
const COMPANY_CACHE_MS = 30_000;

const loadMasterMap = async (type, ids) => {
  const unique = [...new Set((ids || []).map(oid).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await getModel(type)
    .find({ _id: { $in: unique } })
    .select("name code")
    .lean();
  return new Map(rows.map((r) => [oid(r._id), { _id: r._id, name: r.name, code: r.code || "" }]));
};

/** One Company query → name map + schedule docs (cached 30s) */
const loadCompanyBundle = async (ids) => {
  const names = new Map();
  const schedules = new Map();
  const unique = [...new Set((ids || []).map(oid).filter(Boolean))];
  if (!unique.length) return { names, schedules };

  const now = Date.now();
  const missing = [];
  for (const id of unique) {
    const hit = companyBundleCache.get(id);
    if (hit && now - hit.at < COMPANY_CACHE_MS) {
      names.set(id, hit.name);
      schedules.set(id, hit.doc);
    } else missing.push(id);
  }

  if (missing.length) {
    const Company = require("../models/Company");
    const rows = await Company.find({ _id: { $in: missing } })
      .select(
        "companyName branches.branchId branches.shifts.shiftId branches.shifts.isActive branches.shifts.monthlySchedule"
      )
      .lean();
    for (const r of rows) {
      const id = oid(r._id);
      const name = { _id: r._id, companyName: r.companyName || "" };
      companyBundleCache.set(id, { at: now, name, doc: r });
      names.set(id, name);
      schedules.set(id, r);
    }
  }
  return { names, schedules };
};

const dayTimingOf = (company, branchId, shiftId, dateStr) => {
  if (!company) return null;
  const bId = oid(branchId);
  const sId = oid(shiftId);
  const branch = (company.branches || []).find((b) => oid(b.branchId) === bId);
  const shift = (branch?.shifts || []).find(
    (s) => oid(s.shiftId) === sId && s.isActive !== false
  );
  if (!shift) return null;
  const day = dayScheduleOf(shift.monthlySchedule, dateStr);
  if (!day) return null;
  return {
    startTime: day.isOff ? "" : day.startTime || "",
    endTime: day.isOff ? "" : day.endTime || "",
    isOff: !!day.isOff,
  };
};

const shiftWithTiming = (master, timing) => {
  if (!master && !timing) return null;
  return {
    _id: master?._id || null,
    name: master?.name || "",
    code: master?.code || "",
    startTime: timing?.startTime || "",
    endTime: timing?.endTime || "",
    isOff: !!timing?.isOff,
  };
};

const employeeDailyCard = (emp) => ({
  _id: emp._id,
  name: emp.name || "",
  email: emp.official?.officialEmail || "",
  employeeCode: emp.official?.employeeCode || "",
  department: emp.official?.department || "",
  designation: emp.official?.designation || "",
  mobileNo: emp.personal?.mobileNo || "",
  avatar: emp.avatar || "",
  role: emp.role || "",
});

/**
 * Late vs that day's shift start → Late + canApproveReject.
 * Approve → Present · Reject → Absent · On-time open punch → Working.
 */
const applyLateStatus = (att, timing) => {
  const decided = att?.remarkStatus === "Approved" || att?.remarkStatus === "Rejected";
  let lateBy = Number(att?.lateByMinutes) || 0;
  if (att?.punchIn && timing && !timing.isOff && timing.startTime) {
    lateBy = lateByMinutesOf(att.punchIn, timing.startTime, DEFAULT_SHIFT.graceMinutes);
  }
  const isLate = lateBy > 0;
  let remarkStatus = att?.remarkStatus || null;
  let status = att?.status || "Absent";
  let canApproveReject = false;

  if (!att?.punchIn) {
    status = "Absent";
    remarkStatus = null;
  } else if (decided) {
    status = att.remarkStatus === "Approved" ? "Present" : "Absent";
  } else if (isLate) {
    status = "Late";
    remarkStatus = "Pending";
    canApproveReject = true;
  } else if (remarkStatus === "Pending") {
    status = att.punchOut ? "Present" : "Working";
    canApproveReject = true;
  } else if (!att.punchOut) {
    status = "Working";
  } else if (status === "Pending" || status === "Late") {
    status = "Present";
  }

  const persist =
    att?._id &&
    isLate &&
    !decided &&
    (att.remarkStatus !== "Pending" ||
      att.status !== "Late" ||
      Number(att.lateByMinutes) !== lateBy);

  return { status, remarkStatus, canApproveReject, isLate, lateBy, persist };
};

const queueLateFixes = (fixes) => {
  if (!fixes.length) return;
  Attendance.bulkWrite(fixes).catch(() => {});
};

/** Lean daily / calendar row — table columns only, no duplicate fields */
const buildDailyRow = (emp, att, date, maps) => {
  const companyId = oid(att?.companyId) || userCompanyIds(emp)[0] || "";
  const branchId = oid(att?.branchId) || oid(emp.official?.branchId);
  const shiftId = oid(att?.shift) || oid(emp.official?.shiftId);
  const timing = dayTimingOf(maps.schedules.get(companyId), branchId, shiftId, date);
  const late = applyLateStatus(att, timing);
  const worked = Number(att?.workedMinutes) || 0;

  return {
    row: {
      attendanceId: att?._id || null,
      date,
      employee: employeeDailyCard(emp),
      company: maps.companies.get(companyId) || null,
      branch: maps.branches.get(branchId) || null,
      shift: shiftWithTiming(maps.shifts.get(shiftId), timing),
      punchInTime: att?.punchIn ? formatPunchStamp(att.punchIn) : "",
      punchOutTime: att?.punchOut ? formatPunchStamp(att.punchOut) : "",
      workingHours: formatDurationLabel(worked),
      status: late.status,
      workMode: att?.workMode || "WFO",
      verification: att?.punchInSource || null,
      isLate: late.isLate,
      lateByMinutes: late.lateBy,
      earlyByMinutes: Number(att?.earlyByMinutes) || 0,
      remarks: String(att?.remarks || "").trim(),
      remarkStatus: late.remarkStatus,
      canApproveReject: late.canApproveReject,
    },
    late,
  };
};

const loadDailyMaps = async (employees, attendanceRows) => {
  const [bundle, branches, shifts] = await Promise.all([
    loadCompanyBundle([
      ...employees.flatMap((e) => userCompanyIds(e)),
      ...attendanceRows.map((r) => oid(r.companyId)),
    ]),
    loadMasterMap("branch", [
      ...employees.map((e) => oid(e.official?.branchId)),
      ...attendanceRows.map((r) => oid(r.branchId)),
    ]),
    loadMasterMap("shift", [
      ...employees.map((e) => oid(e.official?.shiftId)),
      ...attendanceRows.map((r) => oid(r.shift)),
    ]),
  ]);
  return {
    companies: bundle.names,
    schedules: bundle.schedules,
    branches,
    shifts,
  };
};

const emptyDailySummary = () => ({
  all: 0,
  present: 0,
  absent: 0,
  late: 0,
  onLeave: 0,
  wfh: 0,
  halfDay: 0,
  working: 0,
  pending: 0,
});

const tallyDailySummary = (summary, row) => {
  summary.all += 1;
  if (row.status === "Present") summary.present += 1;
  else if (row.status === "Absent") summary.absent += 1;
  else if (row.status === "OnLeave") summary.onLeave += 1;
  else if (row.status === "HalfDay") summary.halfDay += 1;
  else if (row.status === "Working") summary.working += 1;
  if (row.status === "Late" || row.isLate) summary.late += 1;
  if (row.status === "WFH" || row.workMode === "WFH") summary.wfh += 1;
  if (row.canApproveReject || row.needsRemarkReview) summary.pending += 1;
};

const passesDailyAttFilters = (row, q) => {
  if (q.workMode && q.workMode !== "ALL" && row.workMode !== q.workMode) return false;
  if (q.status && q.status !== "ALL") {
    if (q.status === "Late") {
      if (!(row.status === "Late" || row.isLate)) return false;
    } else if (row.status !== q.status) return false;
  }
  if ((q.hasRemark === "true" || q.hasRemark === "1") && !row.remarks) return false;
  if (q.remarkStatus && q.remarkStatus !== "ALL" && row.remarkStatus !== q.remarkStatus) {
    return false;
  }
  return true;
};

/**
 * DAILY ATTENDANCE — GET /api/attendance/daily
 * Permission: Attendance → Daily Attendance → view
 * Always today. Filters: search, department, branchId, shiftId, workMode, status, companyId.
 * One row has every daily-table field: employee, code, department, shift,
 * punch in/out, working hours, status, verification, approve/reject.
 */
const listDailyAttendance = async (req, res) => {
  try {
    const date = today();
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const empFilter = scopedEmployeeFilter(req.user);
    if (req.query.department && req.query.department !== "ALL") {
      empFilter["official.department"] = req.query.department;
    }
    if (req.query.branchId && req.query.branchId !== "ALL") {
      empFilter["official.branchId"] = req.query.branchId;
    }
    if (req.query.shiftId && req.query.shiftId !== "ALL") {
      empFilter["official.shiftId"] = req.query.shiftId;
    }
    if (req.query.companyId && req.query.companyId !== "ALL") {
      empFilter["official.companyIds"] = req.query.companyId;
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        empFilter.$or = [
          { name: { $regex: q, $options: "i" } },
          { "official.employeeCode": { $regex: q, $options: "i" } },
          { "official.officialEmail": { $regex: q, $options: "i" } },
        ];
      }
    }

    const needsAttFilter =
      (req.query.workMode && req.query.workMode !== "ALL") ||
      (req.query.status && req.query.status !== "ALL") ||
      req.query.hasRemark === "true" ||
      req.query.hasRemark === "1" ||
      (req.query.remarkStatus && req.query.remarkStatus !== "ALL");

    const meta = () => ({
      reviewerScope: reviewerScopeOf(req.user),
      assignedCompanyIds: hasGlobalCompanyAccess(req.user)
        ? []
        : managementCompanyIds(req.user),
      filters: {
        date,
        search: req.query.search || "",
        department: req.query.department || "ALL",
        branchId: req.query.branchId || "ALL",
        shiftId: req.query.shiftId || "ALL",
        companyId: req.query.companyId || "ALL",
        workMode: req.query.workMode || "ALL",
        status: req.query.status || "ALL",
        hasRemark: req.query.hasRemark || "",
        remarkStatus: req.query.remarkStatus || "ALL",
      },
    });

    // Fast path: Mongo page of employees + light summary scan
    if (!needsAttFilter) {
      const [total, pageEmployees, empIds] = await Promise.all([
        User.countDocuments(empFilter),
        User.find(empFilter)
          .select(EMPLOYEE_DAILY_SELECT)
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.distinct("_id", empFilter),
      ]);

      if (!total) {
        return res.json({
          date,
          summary: emptyDailySummary(),
          total: 0,
          page,
          limit,
          pages: 1,
          ...meta(),
          data: [],
        });
      }

      const [pageAtt, allAtt] = await Promise.all([
        pageEmployees.length
          ? Attendance.find({
              employee: { $in: pageEmployees.map((e) => e._id) },
              date,
            })
              .select(ATTENDANCE_LIST_SELECT)
              .lean()
          : [],
        empIds.length
          ? Attendance.find({ employee: { $in: empIds }, date })
              .select(
                "employee status workMode lateByMinutes remarks remarkStatus punchIn punchOut"
              )
              .lean()
          : [],
      ]);

      const maps = await loadDailyMaps(pageEmployees, pageAtt);
      const byEmp = new Map(pageAtt.map((r) => [oid(r.employee), r]));
      const lateFixes = [];
      const data = pageEmployees.map((emp) => {
        const att = byEmp.get(oid(emp._id));
        const built = buildDailyRow(emp, att, date, maps);
        if (built.late.persist && att) {
          lateFixes.push({
            updateOne: {
              filter: { _id: att._id },
              update: {
                $set: {
                  status: "Late",
                  remarkStatus: "Pending",
                  lateByMinutes: built.late.lateBy,
                },
              },
            },
          });
        }
        return built.row;
      });
      queueLateFixes(lateFixes);

      const summary = emptyDailySummary();
      const punched = new Set();
      for (const att of allAtt) {
        punched.add(oid(att.employee));
        const decided =
          att.remarkStatus === "Approved" || att.remarkStatus === "Rejected";
        const isLate = (Number(att.lateByMinutes) || 0) > 0;
        let status = att.status || "Absent";
        if (!att.punchIn) status = "Absent";
        else if (decided) status = att.remarkStatus === "Approved" ? "Present" : "Absent";
        else if (isLate) status = "Late";
        else if (att.punchIn && !att.punchOut) status = "Working";
        tallyDailySummary(summary, {
          status,
          workMode: att.workMode || "WFO",
          isLate,
          canApproveReject:
            (isLate && !decided) || att.remarkStatus === "Pending",
        });
      }
      const absentExtra = Math.max(0, empIds.length - punched.size);
      summary.absent += absentExtra;
      summary.all += absentExtra;

      return res.json({
        date,
        summary,
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
        ...meta(),
        data,
      });
    }

    // Attendance-field filters: build all rows then paginate
    const employees = await User.find(empFilter)
      .select(EMPLOYEE_DAILY_SELECT)
      .sort({ name: 1 })
      .lean();
    const empIds = employees.map((e) => e._id);
    const attendanceRows = empIds.length
      ? await Attendance.find({ employee: { $in: empIds }, date })
          .select(ATTENDANCE_LIST_SELECT)
          .lean()
      : [];
    const byEmp = new Map(attendanceRows.map((r) => [oid(r.employee), r]));
    const maps = await loadDailyMaps(employees, attendanceRows);

    const lateFixes = [];
    const rows = [];
    for (const emp of employees) {
      const att = byEmp.get(oid(emp._id));
      const built = buildDailyRow(emp, att, date, maps);
      if (built.late.persist && att) {
        lateFixes.push({
          updateOne: {
            filter: { _id: att._id },
            update: {
              $set: {
                status: "Late",
                remarkStatus: "Pending",
                lateByMinutes: built.late.lateBy,
              },
            },
          },
        });
      }
      if (passesDailyAttFilters(built.row, req.query)) rows.push(built.row);
    }
    queueLateFixes(lateFixes);

    const summary = emptyDailySummary();
    for (const row of rows) tallyDailySummary(summary, row);
    const total = rows.length;

    return res.json({
      date,
      summary,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      ...meta(),
      data: rows.slice(skip, skip + limit),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * CALENDAR — GET /api/attendance/calendar?month=YYYY-MM&date=YYYY-MM-DD
 * One call: month day counts + the selected day's employee rows (same fields as daily).
 */
const attendanceCalendar = async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "")
      ? req.query.month
      : today().slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${month}-${String(last).padStart(2, "0")}`;
    let date = req.query.date || today();
    if (date < from || date > to) {
      date = today() >= from && today() <= to ? today() : from;
    }

    const empFilter = scopedEmployeeFilter(req.user);
    if (req.query.companyId && req.query.companyId !== "ALL") {
      empFilter["official.companyIds"] = req.query.companyId;
    }
    if (req.query.department && req.query.department !== "ALL") {
      empFilter["official.department"] = req.query.department;
    }
    if (req.query.branchId && req.query.branchId !== "ALL") {
      empFilter["official.branchId"] = req.query.branchId;
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const dayFilter = { ...empFilter };
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        dayFilter.$or = [
          { name: { $regex: q, $options: "i" } },
          { "official.employeeCode": { $regex: q, $options: "i" } },
          { "official.officialEmail": { $regex: q, $options: "i" } },
        ];
      }
    }

    const [empIds, dayTotal, dayEmployees] = await Promise.all([
      User.distinct("_id", empFilter),
      User.countDocuments(dayFilter),
      User.find(dayFilter)
        .select(EMPLOYEE_DAILY_SELECT)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const employeeCount = empIds.length;

    const [monthRecords, dayRows] = await Promise.all([
      empIds.length
        ? Attendance.find({
            employee: { $in: empIds },
            date: { $gte: from, $lte: to },
          })
            .select("date status lateByMinutes workMode punchIn punchOut")
            .lean()
        : [],
      dayEmployees.length
        ? Attendance.find({
            employee: { $in: dayEmployees.map((e) => e._id) },
            date,
          })
            .select(ATTENDANCE_LIST_SELECT)
            .lean()
        : [],
    ]);

    const byDate = new Map();
    const ensure = (d) => {
      if (!byDate.has(d)) {
        byDate.set(d, {
          date: d,
          present: 0,
          absent: 0,
          late: 0,
          onLeave: 0,
          wfh: 0,
          halfDay: 0,
          punched: 0,
        });
      }
      return byDate.get(d);
    };

    const cursor = new Date(`${from}T12:00:00+05:30`);
    const end = new Date(`${to}T12:00:00+05:30`);
    while (cursor <= end) {
      ensure(cursor.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const r of monthRecords) {
      const bucket = ensure(r.date);
      bucket.punched += 1;
      if (r.status === "Present") bucket.present += 1;
      else if (r.status === "Absent") bucket.absent += 1;
      else if (r.status === "HalfDay") bucket.halfDay += 1;
      else if (r.status === "OnLeave") bucket.onLeave += 1;
      else if (r.status === "WFH" || r.workMode === "WFH") bucket.wfh += 1;
      if (r.status === "Late" || (Number(r.lateByMinutes) || 0) > 0) bucket.late += 1;
    }

    const days = [...byDate.values()]
      .map((d) => ({
        date: d.date,
        present: d.present,
        absent: d.absent + Math.max(0, employeeCount - d.punched),
        late: d.late,
        onLeave: d.onLeave,
        wfh: d.wfh,
        halfDay: d.halfDay,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary = { present: 0, absent: 0, late: 0, onLeave: 0, wfh: 0, halfDay: 0 };
    for (const d of days) {
      summary.present += d.present;
      summary.absent += d.absent;
      summary.late += d.late;
      summary.onLeave += d.onLeave;
      summary.wfh += d.wfh;
      summary.halfDay += d.halfDay;
    }

    const byEmp = new Map(dayRows.map((r) => [oid(r.employee), r]));
    const maps = await loadDailyMaps(dayEmployees, dayRows);
    const lateFixes = [];
    const data = dayEmployees.map((emp) => {
      const att = byEmp.get(oid(emp._id));
      const built = buildDailyRow(emp, att, date, maps);
      if (built.late.persist && att) {
        lateFixes.push({
          updateOne: {
            filter: { _id: att._id },
            update: {
              $set: {
                status: "Late",
                remarkStatus: "Pending",
                lateByMinutes: built.late.lateBy,
              },
            },
          },
        });
      }
      return built.row;
    });
    queueLateFixes(lateFixes);

    return res.json({
      month,
      date,
      summary,
      day: days.find((d) => d.date === date) || null,
      days,
      total: dayTotal,
      page,
      limit,
      pages: Math.max(1, Math.ceil(dayTotal / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * REMARK REVIEW — POST /api/attendance/:id/review-remark
 * Body: { decision: "approve" | "reject" }
 * Approve → Present · Reject → Absent
 *
 * Access (never changes User assignment):
 *   Super Admin / Admin → every company
 *   HR Manager          → employee whose company is IN HR's official.companyIds
 *                         (HR can have many companies — all assigned ones work)
 *   Reporting Manager   → team only (reportingHead1 / reportingHead2)
 */
const reviewRemark = async (req, res) => {
  try {
    const decision = String(req.body.decision || "").toLowerCase();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        message: 'decision must be "approve" or "reject"',
      });
    }

    // Need companyIds + reporting heads for scope checks
    const record = await Attendance.findById(req.params.id).populate(
      "employee",
      "name role official.employeeCode official.department official.designation official.companyIds official.reportingHead1 official.reportingHead2"
    );
    if (!record) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    if (record.remarkStatus !== "Pending") {
      return res.status(400).json({
        message: record.remarkStatus
          ? `Already ${record.remarkStatus}`
          : "Nothing to approve or reject",
      });
    }

    // Super Admin / Admin → all
    // HR → any overlap between HR.companyIds and employee.companyIds
    // Manager → team only
    const scopeErr = assertTeamOrCompanyEmployee(req.user, record.employee);
    if (scopeErr) {
      return res.status(403).json({ message: scopeErr });
    }

    if (decision === "approve") {
      record.status = "Present";
      record.remarkStatus = "Approved";
    } else {
      record.status = "Absent";
      record.remarkStatus = "Rejected";
    }

    record.remarkReviewedBy = req.user._id;
    record.remarkReviewedAt = new Date();
    await record.save();

    const { shift, company, branch } = await getAssignedShift(
      record.employee._id || record.employee,
      record.date
    );

    // HR's assigned company ids (for UI / debug) — empty for Super Admin/Admin
    const assignedCompanyIds = hasGlobalCompanyAccess(req.user)
      ? []
      : managementCompanyIds(req.user);

    return res.json({
      message:
        decision === "approve"
          ? "Approved — status is Present"
          : "Rejected — status is Absent",
      decision,
      // all | assigned_companies | team
      reviewerScope: reviewerScopeOf(req.user),
      // HR: list of company ids they can approve for (all assigned)
      assignedCompanyIds,
      record: formatAttendanceRecord(
        record,
        punchExtras({ company, branch, shift })
      ),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Simple shortcut — POST /api/attendance/:id/approve (no body) */
const approveRemark = (req, res) => {
  req.body = { ...(req.body || {}), decision: "approve" };
  return reviewRemark(req, res);
};

/** Simple shortcut — POST /api/attendance/:id/reject (no body) */
const rejectRemark = (req, res) => {
  req.body = { ...(req.body || {}), decision: "reject" };
  return reviewRemark(req, res);
};

module.exports = {
  punchIn,
  punchOut,
  myToday,
  listWebPunches,
  listDailyAttendance,
  attendanceCalendar,
  reviewRemark,
  approveRemark,
  rejectRemark,
};
