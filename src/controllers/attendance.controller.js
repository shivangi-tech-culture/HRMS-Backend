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
const Company = require("../models/Company");
const { getModel } = require("../models/Master");
const { SELF_SOURCES } = require("../validators/attendance.validation");
const { resolvePunchLocation } = require("../utils/geocode");
const {
  todayDate,
  getAssignedShift, // attendance-only read of company/branch/shift
  validatePunchAgainstShift,
  computeDayMetrics,
  overtimeAfterShiftEnd,
  formatPunchStamp,
  dayScheduleOf,
  minutesOfDay,
  parseHm,
  normalizeHm,
  punchInWindow,
  sameDayClock,
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
  escapeRegex,
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
const { resolveDisplayedStatus } = require("../utils/attendanceDayStatus");

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
 * Hours and day status from the employee's shift.
 * Punch in only → MissedPunch. Punch out → Present or HalfDay.
 */
const applyMetrics = (record, shift) => {
  const metrics = computeDayMetrics(record, shift, record.date);
  record.workedMinutes = metrics.workedMinutes;
  record.overtimeMinutes = metrics.overtimeMinutes;
  record.lateByMinutes = metrics.lateByMinutes;
  record.earlyByMinutes = metrics.earlyByMinutes;
  record.status = metrics.status;
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

/** Saved when a late punch has no employee note */
const DEFAULT_LATE_REMARK = "Late punch-in";

/** Fields needed so every punch / review card includes official email */
const EMPLOYEE_CARD_SELECT =
  "name role official.employeeCode official.officialEmail official.department official.designation";

/** Punch-out note only. Day stays Present. Late approval is unchanged. */
const applyRemarkOnPunch = (record, text) => {
  if (!text) return;
  record.remarks = text;
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
        EMPLOYEE_CARD_SELECT
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
    record.workedMinutes = 0;
    record.overtimeMinutes = 0;
    record.lateByMinutes = windowCheck.isLate ? windowCheck.lateByMinutes || 0 : 0;
    record.earlyByMinutes = windowCheck.isEarly ? windowCheck.earlyByMinutes || 0 : 0;
    record.reviewReason = "";
    // Not Present yet. Missed punch until they punch out against this shift.
    record.status = "MissedPunch";
    record.remarks = remarks;
    if (windowCheck.isLate) {
      record.remarks = remarks || DEFAULT_LATE_REMARK;
      record.attendanceStatus = "Late";
    } else if (windowCheck.isEarly) {
      record.attendanceStatus = "Early";
    } else {
      record.attendanceStatus = "On time";
    }
    await record.save();

    await record.populate(
      "employee",
      EMPLOYEE_CARD_SELECT
    );

    const punchInMessage = windowCheck.isLate
      ? "Punched in late — Missed punch until punch out"
      : windowCheck.isEarly
        ? "Punched in early — Missed punch until punch out"
        : "Punched in — Missed punch until punch out";

    return res.status(201).json(
      punchPayload(punchInMessage, { company, branch, shift, record })
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
        EMPLOYEE_CARD_SELECT
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
    applyMetrics(record, shift); // Present or HalfDay from this shift, only because punch out is set
    if (record.attendanceStatus !== "Approved" && record.attendanceStatus !== "Rejected") {
      const arrived = punchInWindow(
        record.punchIn ? minutesOfDay(record.punchIn) : null,
        parseHm(shift?.startTime),
        shift?.graceMinutes
      );
      record.lateByMinutes = arrived.lateByMinutes;
      if (arrived.isLate) {
        record.attendanceStatus = "Late";
        if (!String(record.remarks || "").trim()) record.remarks = DEFAULT_LATE_REMARK;
      } else if (arrived.isEarly) {
        record.attendanceStatus = "Early";
        if (record.remarks === DEFAULT_LATE_REMARK) record.remarks = "";
      } else {
        record.attendanceStatus = "On time";
        if (record.remarks === DEFAULT_LATE_REMARK) record.remarks = "";
      }
    }
    await record.save();

    await record.populate(
      "employee",
      EMPLOYEE_CARD_SELECT
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
      EMPLOYEE_CARD_SELECT;

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
      if (record.punchIn && !record.punchOut && record.status !== "MissedPunch") {
        record.status = "MissedPunch";
        dirty = true;
      }
      if (record.punchIn && record.punchOut) {
        applyMetrics(record, shift);
        dirty = true;
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
      email: req.user.official?.officialEmail || "",
      official: {
        employeeCode: req.user.official?.employeeCode || "",
        officialEmail: req.user.official?.officialEmail || "",
      },
    };

    // Own history only — lean select (no populate). Cap scan for safety.
    const records = await Attendance.find(filter)
      .select(
        "date status punchIn punchOut punchInSource punchOutSource punchInLocation punchOutLocation remarks attendanceStatus"
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
          status: r.punchIn && !r.punchOut ? "MissedPunch" : r.status,
          punchTime: r.punchIn,
          punchMode: "IN",
          punchType: r.punchInSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchInLocation || {},
          remarks: r.remarks || "",
          attendanceStatus: r.attendanceStatus || null,
          source: r.punchInSource,
          date: r.date,
        });
      }
      if (r.punchOut) {
        punches.push({
          _id: `${r._id}-out`,
          attendanceId: r._id,
          employee,
          status: r.punchIn && !r.punchOut ? "MissedPunch" : r.status,
          punchTime: r.punchOut,
          punchMode: "OUT",
          punchType: r.punchOutSource === "manual" ? "Manual" : "Work From Office",
          location: r.punchOutLocation || {},
          remarks: r.remarks || "",
          attendanceStatus: r.attendanceStatus || null,
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
 * Super Admin / Admin → one company at a time (see resolveListCompanyId)
 * HR → employees in their assigned companies
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

/**
 * Company for daily + calendar rows.
 * Super Admin / Admin → pass companyId, or the first created active company.
 * HR → own company (first official.companyIds). Another id only if it is assigned.
 * Reporting Manager → no company default; optional companyId narrows the team.
 */
const resolveListCompanyId = async (actor, raw) => {
  const requested = String(raw || "").trim();
  const explicit = Boolean(requested && requested !== "ALL");

  if (isTeamScopedRole(normalizeRoleName(actor?.role))) {
    return explicit ? { companyId: requested } : {};
  }

  if (hasGlobalCompanyAccess(actor)) {
    if (explicit) {
      const doc = await Company.findOne({ _id: requested, isActive: { $ne: false } })
        .select("_id")
        .lean();
      if (!doc) return { error: "Company not found", status: 404 };
      return { companyId: String(doc._id) };
    }
    const first = await Company.findOne({ isActive: { $ne: false } })
      .sort({ createdAt: 1, _id: 1 })
      .select("_id")
      .lean();
    if (!first) return { none: true };
    return { companyId: String(first._id) };
  }

  const ids = managementCompanyIds(actor);
  if (!ids.length) return { none: true };
  if (!explicit) return { companyId: ids[0] };
  if (!ids.includes(requested)) {
    return {
      error: "You can only view attendance for your assigned company",
      status: 403,
    };
  }
  return { companyId: requested };
};

const applyListCompany = (empFilter, resolved) => {
  if (resolved.none) {
    empFilter._id = { $in: [] };
    return;
  }
  if (resolved.companyId) empFilter["official.companyIds"] = resolved.companyId;
};

const ATTENDANCE_LIST_SELECT =
  "employee date companyId branchId shift punchIn punchOut punchInSource workMode workedMinutes overtimeMinutes lateByMinutes earlyByMinutes status remarks attendanceStatus reviewReason";

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
  const clock = sameDayClock(day.startTime, day.endTime);
  return {
    startTime: day.isOff ? "" : clock.startTime || "",
    endTime: day.isOff ? "" : clock.endTime || "",
    isOff: !!day.isOff,
    graceMinutes: DEFAULT_SHIFT.graceMinutes,
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
    graceMinutes: timing?.graceMinutes ?? DEFAULT_SHIFT.graceMinutes,
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
 * Punch-in → Present, even when late.
 * attendanceStatus: Early · On time · Late · Approved · Rejected
 */
const applyLateStatus = (att, timing) => {
  const reviewed =
    att?.attendanceStatus === "Approved" || att?.attendanceStatus === "Rejected";
  let lateBy = Number(att?.lateByMinutes) || 0;
  let earlyBy = 0;
  let isEarly = false;
  if (att?.punchIn && timing && !timing.isOff && timing.startTime) {
    const punchMin = minutesOfDay(att.punchIn);
    const startMin = parseHm(timing.startTime);
    const grace = timing.graceMinutes ?? DEFAULT_SHIFT.graceMinutes;
    const arrived = punchInWindow(punchMin, startMin, grace);
    isEarly = arrived.isEarly;
    earlyBy = arrived.earlyByMinutes;
    lateBy = arrived.lateByMinutes;
  }
  const isLate = lateBy > 0;
  const written = String(att?.remarks || "").trim();
  const needsReview = Boolean(att?.punchIn) && isLate && !reviewed;
  let attendanceStatus = null;
  let status = "Absent";
  let canApproveReject = false;
  let remarks = written;

  if (!att?.punchIn) {
    status = "Absent";
  } else if (!att?.punchOut) {
    status = "MissedPunch";
  } else {
    status = "Present";
    if (reviewed) attendanceStatus = att.attendanceStatus;
    else if (isLate) {
      attendanceStatus = "Late";
      canApproveReject = true;
      if (!remarks) remarks = DEFAULT_LATE_REMARK;
    } else {
      attendanceStatus = isEarly ? "Early" : "On time";
    }
  }

  const persist =
    att?._id &&
    Boolean(att?.punchIn) &&
    Boolean(att?.punchOut) &&
    !reviewed &&
    (att.attendanceStatus !== attendanceStatus ||
      att.status !== "Present" ||
      Number(att.lateByMinutes) !== lateBy ||
      (needsReview && !written));

  return {
    status,
    attendanceStatus,
    canApproveReject,
    isLate,
    isEarly,
    lateBy,
    earlyBy,
    persist,
    remarks,
    defaultRemark: needsReview && !written ? DEFAULT_LATE_REMARK : "",
  };
};

/** Pending / approved / rejected regularization for this day, latest per employee. */
const loadRegularizationMap = (employeeIds, date) => {
  const { loadLatestRegularization } = require("./regularization.controller");
  return loadLatestRegularization(employeeIds, date);
};

const queueLateFixes = (fixes) => {
  if (!fixes.length) return;
  Attendance.bulkWrite(fixes).catch(() => {});
};

const lateFixOp = (att, late) => {
  const $set = {
    status: "Present",
    attendanceStatus: late.attendanceStatus,
    lateByMinutes: late.lateBy,
    earlyByMinutes: late.earlyBy,
  };
  if (late.defaultRemark) $set.remarks = late.defaultRemark;
  if (!late.isLate && String(att.remarks || "").trim() === DEFAULT_LATE_REMARK) $set.remarks = "";
  return {
    updateOne: {
      filter: { _id: att._id },
      update: { $set },
    },
  };
};

/** Lean daily / calendar row — table columns only, no duplicate fields */
const buildDailyRow = (emp, att, date, maps, reg) => {
  const companyId = oid(att?.companyId) || userCompanyIds(emp)[0] || "";
  const branchId = oid(att?.branchId) || oid(emp.official?.branchId);
  const shiftId = oid(att?.shift) || oid(emp.official?.shiftId);
  const timing = dayTimingOf(maps.schedules.get(companyId), branchId, shiftId, date);
  const late = applyLateStatus(att, timing);
  const worked = Number(att?.workedMinutes) || 0;
  const overtime = overtimeAfterShiftEnd(att?.punchOut, timing?.endTime);
  const status = resolveDisplayedStatus({ att, reg, lateStatus: late.status });

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
      overtime: formatDurationLabel(overtime),
      overtimeMinutes: overtime,
      status,
      workMode: att?.workMode || "WFO",
      verification: att?.punchInSource || null,
      isLate: late.isLate,
      isEarly: late.isEarly,
      lateByMinutes: late.lateBy,
      earlyByMinutes: late.earlyBy,
      remarks: late.remarks,
      attendanceStatus: late.attendanceStatus,
      reviewReason: String(att?.reviewReason || "").trim(),
      canApproveReject: late.canApproveReject,
      awaitingPunchOut: Boolean(att?.punchIn) && !att?.punchOut && status === "MissedPunch",
      regularizationStatus: reg?.status || null,
      regularizationId: reg?._id || null,
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
  missedPunch: 0,
  rejected: 0,
});

const tallyDailySummary = (summary, row) => {
  summary.all += 1;
  if (row.status === "Present") summary.present += 1;
  else if (row.status === "Absent" || row.status === "Rejected") summary.absent += 1;
  else if (row.status === "OnLeave") summary.onLeave += 1;
  else if (row.status === "HalfDay") summary.halfDay += 1;
  else if (row.status === "Working") summary.working += 1;
  else if (row.status === "MissedPunch") summary.missedPunch += 1;
  if (row.status === "Rejected") summary.rejected += 1;
  if (row.isLate && (row.status === "Present" || row.status === "Late")) summary.late += 1;
  if (row.status === "WFH" || row.workMode === "WFH") summary.wfh += 1;
  if (row.status === "Pending" || row.canApproveReject || row.needsRemarkReview) summary.pending += 1;
};

const applyEmployeeSearch = (filter, search) => {
  const q = String(search || "").trim();
  if (!q) return filter;
  const rx = new RegExp(escapeRegex(q), "i");
  const clause = {
    $or: [
      { name: rx },
      { "official.employeeCode": rx },
      { "official.officialEmail": rx },
    ],
  };
  if (filter.$or || filter.$and) {
    filter.$and = [...(filter.$and || []), ...(filter.$or ? [{ $or: filter.$or }] : []), clause];
    delete filter.$or;
  } else {
    filter.$or = clause.$or;
  }
  return filter;
};

const needsAttendanceRowFilter = (q) =>
  (q.workMode && q.workMode !== "ALL") ||
  (q.status && q.status !== "ALL") ||
  q.hasRemark === "true" ||
  q.hasRemark === "1" ||
  q.hasRemark === "false" ||
  q.hasRemark === "0" ||
  (q.attendanceStatus && q.attendanceStatus !== "ALL");
const passesDailyAttFilters = (row, q) => {
  if (q.workMode && q.workMode !== "ALL" && row.workMode !== q.workMode) return false;
  if (q.status && q.status !== "ALL") {
    const s = q.status;
    if (s === "Late") {
      if (!(row.isLate || row.attendanceStatus === "Late")) return false;
    } else if (s === "Working") {
      if (row.status !== "Working") return false;
    } else if (s === "WFH") {
      if (!(row.status === "WFH" || row.workMode === "WFH")) return false;
    } else if (s === "Present") {
      if (row.status !== "Present" || row.isLate) return false;
    } else if (row.status !== s) return false;
  }
  if ((q.hasRemark === "true" || q.hasRemark === "1") && !row.remarks) return false;
  if ((q.hasRemark === "false" || q.hasRemark === "0") && row.remarks) return false;
  if (q.attendanceStatus && q.attendanceStatus !== "ALL" && row.attendanceStatus !== q.attendanceStatus) {
    return false;
  }
  return true;
};

/**
 * DAILY ATTENDANCE — GET /api/attendance/daily
 * Permission: Attendance → Daily Attendance → view
 * ?date=YYYY-MM-DD (default today, previous dates allowed) and ?companyId=
 * Punch in without punch out is MissedPunch until punch out or an approved regularization.
 * A pending regularization shows Pending. Rejected stays Absent.
 * Super Admin / Admin: one company. No companyId → first created company.
 * HR: own assigned company (companyIds[0]), or another id only if assigned to them.
 */
const listDailyAttendance = async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || today();
    if (date > today()) {
      return res.status(400).json({ message: "Date cannot be in the future" });
    }
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const companyScope = await resolveListCompanyId(req.user, req.query.companyId);
    if (companyScope.error) {
      return res.status(companyScope.status).json({ message: companyScope.error });
    }

    const empFilter = scopedEmployeeFilter(req.user);
    applyListCompany(empFilter, companyScope);
    if (req.query.department && req.query.department !== "ALL") {
      empFilter["official.department"] = req.query.department;
    }
    if (req.query.branchId && req.query.branchId !== "ALL") {
      empFilter["official.branchId"] = req.query.branchId;
    }
    if (req.query.shiftId && req.query.shiftId !== "ALL") {
      empFilter["official.shiftId"] = req.query.shiftId;
    }
    applyEmployeeSearch(empFilter, req.query.search);

    const needsAttFilter = needsAttendanceRowFilter(req.query);

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
        companyId: companyScope.companyId || req.query.companyId || "ALL",
        workMode: req.query.workMode || "ALL",
        status: req.query.status || "ALL",
        hasRemark: req.query.hasRemark || "",
        attendanceStatus: req.query.attendanceStatus || "ALL",
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

      const [pageAtt, allAtt, regByEmp] = await Promise.all([
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
                "employee status workMode lateByMinutes remarks attendanceStatus punchIn punchOut"
              )
              .lean()
          : [],
        loadRegularizationMap(empIds, date),
      ]);

      const maps = await loadDailyMaps(pageEmployees, pageAtt);
      const byEmp = new Map(pageAtt.map((r) => [oid(r.employee), r]));
      const lateFixes = [];
      const data = pageEmployees.map((emp) => {
        const att = byEmp.get(oid(emp._id));
        const built = buildDailyRow(emp, att, date, maps, regByEmp.get(oid(emp._id)));
        if (built.late.persist && att) {
          lateFixes.push(lateFixOp(att, built.late));
        }
        return built.row;
      });
      queueLateFixes(lateFixes);

      const summary = emptyDailySummary();
      const punched = new Set();
      for (const att of allAtt) {
        const key = oid(att.employee);
        punched.add(key);
        const reviewed =
          att.attendanceStatus === "Approved" || att.attendanceStatus === "Rejected";
        const isLate = (Number(att.lateByMinutes) || 0) > 0;
        const reg = regByEmp.get(key);
        const status = resolveDisplayedStatus({
          att,
          reg,
          lateStatus: att.punchIn && att.punchOut ? "Present" : "Absent",
        });
        tallyDailySummary(summary, {
          status,
          workMode: att.workMode || "WFO",
          isLate: isLate && status === "Present",
          canApproveReject:
            status !== "Pending" && Boolean(att.punchIn) && isLate && !reviewed,
        });
      }
      for (const id of empIds) {
        const key = oid(id);
        if (punched.has(key)) continue;
        const status = resolveDisplayedStatus({
          att: null,
          reg: regByEmp.get(key),
          lateStatus: "Absent",
        });
        tallyDailySummary(summary, {
          status,
          workMode: "WFO",
          isLate: false,
          canApproveReject: false,
        });
      }

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
    const [maps, regByEmp] = await Promise.all([
      loadDailyMaps(employees, attendanceRows),
      loadRegularizationMap(empIds, date),
    ]);

    const lateFixes = [];
    const rows = [];
    for (const emp of employees) {
      const att = byEmp.get(oid(emp._id));
      const built = buildDailyRow(emp, att, date, maps, regByEmp.get(oid(emp._id)));
      if (built.late.persist && att) {
        lateFixes.push(lateFixOp(att, built.late));
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

    const companyScope = await resolveListCompanyId(req.user, req.query.companyId);
    if (companyScope.error) {
      return res.status(companyScope.status).json({ message: companyScope.error });
    }

    const empFilter = scopedEmployeeFilter(req.user);
    applyListCompany(empFilter, companyScope);
    if (req.query.department && req.query.department !== "ALL") {
      empFilter["official.department"] = req.query.department;
    }
    if (req.query.branchId && req.query.branchId !== "ALL") {
      empFilter["official.branchId"] = req.query.branchId;
    }
    if (req.query.shiftId && req.query.shiftId !== "ALL") {
      empFilter["official.shiftId"] = req.query.shiftId;
    }

    const todayStr = today();
    const dayFilter = applyEmployeeSearch({ ...empFilter }, req.query.search);
    const rowFilterOn = needsAttendanceRowFilter(req.query);

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const [empIds, listEmployees] = await Promise.all([
      User.distinct("_id", empFilter),
      User.find(dayFilter)
        .select(EMPLOYEE_DAILY_SELECT)
        .sort({ name: 1 })
        .lean(),
    ]);
    const employeeCount = empIds.length;

    const monthRecords = empIds.length
      ? await Attendance.find({
          employee: { $in: empIds },
          date: { $gte: from, $lte: to },
        })
          .select("date status lateByMinutes workMode punchIn punchOut employee")
          .lean()
      : [];

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
          missedPunch: 0,
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
      const openPunch = r.punchIn && !r.punchOut;
      if (openPunch) bucket.missedPunch += 1;
      else if (r.status === "HalfDay") bucket.halfDay += 1;
      else if (r.status === "OnLeave") bucket.onLeave += 1;
      else if (r.status === "WFH" || r.workMode === "WFH") bucket.wfh += 1;
      else if (r.status === "Absent") bucket.absent += 1;
      else if (r.punchIn && r.punchOut) bucket.present += 1;
      if (!openPunch && (r.status === "Late" || (Number(r.lateByMinutes) || 0) > 0)) bucket.late += 1;
    }

    const days = [...byDate.values()]
      .map((d) => {
        const started = d.date <= todayStr;
        return {
          date: d.date,
          employees: employeeCount,
          present: d.present,
          absent: started ? d.absent + Math.max(0, employeeCount - d.punched) : 0,
          late: d.late,
          onLeave: d.onLeave,
          wfh: d.wfh,
          halfDay: d.halfDay,
          missedPunch: d.missedPunch,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary = { present: 0, absent: 0, late: 0, onLeave: 0, wfh: 0, halfDay: 0, missedPunch: 0 };
    for (const d of days) {
      summary.present += d.present;
      summary.absent += d.absent;
      summary.late += d.late;
      summary.onLeave += d.onLeave;
      summary.wfh += d.wfh;
      summary.halfDay += d.halfDay;
      summary.missedPunch += d.missedPunch;
    }

    const dayRows = listEmployees.length
      ? await Attendance.find({
          employee: { $in: listEmployees.map((e) => e._id) },
          date,
        })
          .select(ATTENDANCE_LIST_SELECT)
          .lean()
      : [];
    const byEmp = new Map(dayRows.map((r) => [oid(r.employee), r]));
    const [maps, regByEmp] = await Promise.all([
      loadDailyMaps(listEmployees, dayRows),
      loadRegularizationMap(listEmployees.map((e) => e._id), date),
    ]);
    const lateFixes = [];
    const rows = [];
    for (const emp of listEmployees) {
      const att = byEmp.get(oid(emp._id));
      const built = buildDailyRow(emp, att, date, maps, regByEmp.get(oid(emp._id)));
      if (date > todayStr && !att?.punchIn && built.row.status !== "WeeklyOff") built.row.status = "";
      if (built.late.persist && att) lateFixes.push(lateFixOp(att, built.late));
      if (!rowFilterOn || passesDailyAttFilters(built.row, req.query)) rows.push(built.row);
    }
    queueLateFixes(lateFixes);

    const total = rows.length;
    const data = rows.slice(skip, skip + limit);

    return res.json({
      month,
      date,
      companyId: companyScope.companyId || null,
      employees: employeeCount,
      summary,
      day: days.find((d) => d.date === date) || null,
      days,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        search: req.query.search || "",
        department: req.query.department || "ALL",
        branchId: req.query.branchId || "ALL",
        shiftId: req.query.shiftId || "ALL",
        companyId: companyScope.companyId || "ALL",
        workMode: req.query.workMode || "ALL",
        status: req.query.status || "ALL",
        attendanceStatus: req.query.attendanceStatus || "ALL",
        hasRemark: req.query.hasRemark || "",
      },
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * MARK MISSED PUNCH — POST /api/attendance/mark
 * Body: { employeeId, date, punchInTime?, punchOutTime?, reason, remarks? }
 * Sets only the punches sent. Does not change the employee's company, branch, or shift.
 * A finished day can take both times. Today can take the one they forgot.
 */
const clockOnDate = (dateStr, hm, label) => {
  const norm = normalizeHm(hm);
  if (!norm) return { error: `${label} must be 24-hour HH:mm` };
  const at = new Date(`${dateStr}T${norm}:00+05:30`);
  if (Number.isNaN(at.getTime())) return { error: `${label} must be 24-hour HH:mm` };
  if (at.getTime() > Date.now()) return { error: `${label} cannot be in the future` };
  return { at, hm: norm };
};

const markAttendance = async (req, res) => {
  try {
    const employeeId = req.body.employeeId;
    const date = req.body.date;
    if (date > today()) {
      return res.status(400).json({ message: "Date cannot be in the future" });
    }

    const inRaw = String(req.body.punchInTime || "").trim();
    const outRaw = String(req.body.punchOutTime || "").trim();
    if (!inRaw && !outRaw) {
      return res.status(400).json({ message: "punchInTime or punchOutTime is required" });
    }
    const punchIn = inRaw ? clockOnDate(date, inRaw, "Punch in") : null;
    const punchOut = outRaw ? clockOnDate(date, outRaw, "Punch out") : null;
    if (punchIn?.error) return res.status(400).json({ message: punchIn.error });
    if (punchOut?.error) return res.status(400).json({ message: punchOut.error });

    const employee = await User.findById(employeeId).select(
      `${EMPLOYEE_CARD_SELECT} official.companyIds official.reportingHead1 official.reportingHead2 status`
    );
    if (!employee || employee.status === "Deleted") {
      return res.status(404).json({ message: "Employee not found" });
    }
    const scopeErr = assertTeamOrCompanyEmployee(req.user, employee);
    if (scopeErr) return res.status(403).json({ message: scopeErr });

    const { shift, company, branch } = await getAssignedShift(employeeId, date);
    let record = await Attendance.findOne({ employee: employeeId, date });
    if (!record) record = new Attendance({ employee: employeeId, date });
    const created = record.isNew;

    if (punchIn && record.punchIn) {
      return res.status(400).json({ message: "Punch in is already marked for this day" });
    }
    if (punchOut && record.punchOut) {
      return res.status(400).json({ message: "Punch out is already marked for this day" });
    }
    if (punchOut && !record.punchIn && !punchIn) {
      return res.status(400).json({ message: "Punch in is required before punch out" });
    }

    const inAt = punchIn ? punchIn.at : record.punchIn;
    const outAt = punchOut ? punchOut.at : record.punchOut;
    if (inAt && outAt && new Date(outAt).getTime() <= new Date(inAt).getTime()) {
      return res.status(400).json({ message: "Punch out must be after punch in" });
    }

    applyPlacement(record, { company, branch, shift });
    record.markedBy = req.user._id;
    record.markReason = String(req.body.reason || "").trim();
    if (String(req.body.remarks || "").trim()) {
      record.remarks = String(req.body.remarks).trim();
    }

    if (punchIn) {
      record.punchIn = punchIn.at;
      record.punchInSource = "manual";
      const windowCheck = validatePunchAgainstShift(shift, punchIn.at, "in", date);
      const reviewed =
        record.attendanceStatus === "Approved" || record.attendanceStatus === "Rejected";
      if (!reviewed) {
        record.lateByMinutes = windowCheck.isLate ? windowCheck.lateByMinutes || 0 : 0;
        record.earlyByMinutes = windowCheck.isEarly ? windowCheck.earlyByMinutes || 0 : 0;
        record.reviewReason = "";
        if (windowCheck.isLate) {
          if (!String(record.remarks || "").trim()) record.remarks = DEFAULT_LATE_REMARK;
          record.attendanceStatus = "Late";
        } else if (windowCheck.isEarly) {
          record.attendanceStatus = "Early";
        } else {
          record.attendanceStatus = "On time";
        }
      }
    }

    if (punchOut) {
      record.punchOut = punchOut.at;
      record.punchOutSource = "manual";
    }

    const metrics = computeDayMetrics(record, shift, date);
    record.workedMinutes = metrics.workedMinutes;
    record.overtimeMinutes = metrics.overtimeMinutes;
    record.status = metrics.status;

    await record.save();
    await record.populate("employee", EMPLOYEE_CARD_SELECT);

    const marked = [
      punchIn ? `punch in ${punchIn.hm}` : "",
      punchOut ? `punch out ${punchOut.hm}` : "",
    ].filter(Boolean).join(" and ");

    return res.status(created ? 201 : 200).json(
      punchPayload(`Marked ${marked}`, { company, branch, shift, record })
    );
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * LATE REVIEW — POST /api/attendance/:id/review?decision=approve|reject
 * Body: { reason }
 * Only Late. Day status stays Present.
 */
const reviewRemark = async (req, res) => {
  try {
    const decision = String(req.body.decision || "").toLowerCase();
    const reason = String(req.body.reason || "").trim();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        message: 'decision must be "approve" or "reject"',
      });
    }
    if (!reason) {
      return res.status(400).json({ message: "reason is required" });
    }

    // Need companyIds + reporting heads for scope checks
    const record = await Attendance.findById(req.params.id).populate(
      "employee",
      `${EMPLOYEE_CARD_SELECT} official.companyIds official.reportingHead1 official.reportingHead2`
    );
    if (!record) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const awaiting = record.attendanceStatus === "Late" || record.attendanceStatus === "Pending";
    const already =
      record.attendanceStatus === "Approved" || record.attendanceStatus === "Rejected";
    if (!awaiting) {
      return res.status(400).json({
        message: already
          ? `Already ${record.attendanceStatus}`
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

    record.status = record.punchOut ? (record.status === "HalfDay" ? "HalfDay" : "Present") : "MissedPunch";
    record.attendanceStatus = decision === "approve" ? "Approved" : "Rejected";
    record.reviewReason = reason;
    record.remarkReviewedBy = req.user._id;
    record.remarkReviewedAt = new Date();
    await record.save();
    await record.populate({
      path: "remarkReviewedBy",
      select: "name role official.officialEmail",
    });

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
          ? "Late punch approved — status stays Present"
          : "Late punch rejected — status stays Present",
      decision,
      reason,
      reviewedBy: {
        _id: req.user._id,
        name: req.user.name || "",
        role: req.user.role || "",
        email: req.user.official?.officialEmail || "",
      },
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

module.exports = {
  punchIn,
  punchOut,
  myToday,
  listWebPunches,
  listDailyAttendance,
  attendanceCalendar,
  markAttendance,
  reviewRemark,
  resolveListCompanyId,
  applyListCompany,
  scopedEmployeeFilter,
};
