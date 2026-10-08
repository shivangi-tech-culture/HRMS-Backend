/**
 * LATE & EARLY DEPARTURES — /api/attendance/late-early
 *
 * UI tabs:
 *   - Late Arrivals   → punch after shift start + grace
 *   - Early Arrivals  → punch before shift start
 *
 * READ-ONLY attendance data. Does NOT change:
 *   - User.official.companyIds / branchId / shiftId
 *   - Company assignment
 *
 * Permission: Attendance → Late & Early Departures → view
 */
const Attendance = require("../models/Attendance"); // daily punch rows
const User = require("../models/User"); // employee names / dept
const { getModel } = require("../models/Master"); // branch / shift names
const Company = require("../models/Company");
const { resolveListCompanyId, applyListCompany } = require("./attendance.controller");
const {
  todayDate,
  formatPunchStamp,
  dayScheduleOf,
  sameDayClock,
  punchInWindow,
  minutesOfDay,
  parseHm,
  DEFAULT_SHIFT,
  overtimeAfterShiftEnd,
} = require("../utils/shiftTiming");
const {
  formatDurationLabel, // "11m" / "9h 18m"
  oid, // id → string
} = require("../utils/attendanceFormat");
const {
  companyFilter, // HR scoped to their companies
  hasGlobalCompanyAccess, // Super Admin / Admin → all
  userCompanyIds,
  managementCompanyIds,
  escapeRegex,
} = require("../utils/companyScope");
const { teamMemberFilter } = require("../utils/teamScope"); // RM → team only
const {
  normalizeRoleName,
  EMPLOYEE,
  isTeamScopedRole,
} = require("../config/roles");

/**
 * Employees this actor may see (same rules as daily attendance).
 * Does not edit any employee fields.
 */
const scopedEmployeeFilter = (actor) => {
  // Base: active employees only
  const base = {
    role: { $in: [EMPLOYEE, "Employee"] },
    status: { $ne: "Deleted" },
  };

  // Platform admins see everyone
  if (hasGlobalCompanyAccess(actor)) return base;

  // Reporting Manager → only direct reports
  if (isTeamScopedRole(normalizeRoleName(actor.role))) {
    return { ...base, ...teamMemberFilter(actor) };
  }

  // HR → their companyIds only
  const cf = companyFilter(actor);
  if (cf === false) return { _id: { $in: [] } }; // no company → empty
  if (cf) Object.assign(base, cf);
  return base;
};

/** Load branch or shift master map: id → { _id, name, code } */
const loadMasterMap = async (type, ids) => {
  const unique = [...new Set((ids || []).map(oid).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await getModel(type)
    .find({ _id: { $in: unique } })
    .select("name code")
    .lean();
  return new Map(
    rows.map((r) => [oid(r._id), { _id: r._id, name: r.name, code: r.code || "" }])
  );
};

/**
 * Short label for late/early column in UI.
 * Examples: 11 → "11m", 75 → "1h 15m"
 */
const minutesLabel = (mins) => {
  const n = Number(mins) || 0;
  if (n <= 0) return "0m";
  if (n < 60) return `${n}m`;
  return formatDurationLabel(n);
};

/**
 * Build punch timeline for detail drawer:
 * Punch In → Break Start/End… → Punch Out
 */
const buildTimeline = (record) => {
  const events = [];

  // Punch in event
  if (record.punchIn) {
    events.push({
      time: record.punchIn,
      clock: formatPunchStamp(record.punchIn),
      type: "PUNCH_IN",
      label: "Punch In",
      source: record.punchInSource || null,
    });
  }

  // Optional break segments saved on the attendance row
  for (const br of record.breaks || []) {
    if (br.start) {
      events.push({
        time: br.start,
        clock: formatPunchStamp(br.start),
        type: "BREAK_START",
        label: "Break Start",
        source: null,
      });
    }
    if (br.end) {
      events.push({
        time: br.end,
        clock: formatPunchStamp(br.end),
        type: "BREAK_END",
        label: "Break End",
        source: null,
      });
    }
  }

  // Punch out event
  if (record.punchOut) {
    events.push({
      time: record.punchOut,
      clock: formatPunchStamp(record.punchOut),
      type: "PUNCH_OUT",
      label: "Punch Out",
      source: record.punchOutSource || null,
    });
  }

  // Oldest → newest for the timeline UI
  events.sort((a, b) => new Date(a.time) - new Date(b.time));
  return events;
};

/** Total break minutes from breaks[] */
const breakMinutesOf = (record) => {
  let total = 0;
  for (const br of record.breaks || []) {
    if (!br.start || !br.end) continue;
    const diff = Math.max(0, (new Date(br.end) - new Date(br.start)) / 60000);
    total += Math.round(diff);
  }
  return total;
};

/**
 * Map one Attendance lean doc + employee → list row for the table.
 */
const toListRow = (att, emp, shiftMaster, branchMaster, timing) => {
  const late = timing.lateByMinutes;
  const early = timing.earlyByMinutes;
  const worked = Number(att.workedMinutes) || 0;
  const company = timing.company;

  return {
    _id: att._id,
    date: att.date,
    employee: {
      _id: emp?._id || att.employee,
      name: emp?.name || "",
      email: emp?.official?.officialEmail || "",
      employeeCode: emp?.official?.employeeCode || "",
      department: emp?.official?.department || "",
      designation: emp?.official?.designation || "",
    },
    department: emp?.official?.department || "",
    company: company || null,
    branch: branchMaster || null,
    location: branchMaster?.name || "",
    shift: shiftMaster
      ? { ...shiftMaster, startTime: timing.startTime || "", endTime: timing.endTime || "" }
      : null,
    punchInTime: att.punchIn ? formatPunchStamp(att.punchIn) : "",
    punchOutTime: att.punchOut ? formatPunchStamp(att.punchOut) : "",
    lateByMinutes: late,
    lateBy: minutesLabel(late),
    earlyByMinutes: early,
    earlyBy: minutesLabel(early),
    isLate: timing.isLate,
    isEarly: timing.isEarly,
    workedMinutes: worked,
    workingHours: formatDurationLabel(worked),
    status: timing.status,
    attendanceStatus: timing.attendanceStatus,
    verification: att.punchInSource || att.punchOutSource || null,
    workMode: att.workMode || "WFO",
    remarks: att.remarks || "",
  };
};

const dayClock = (company, branchId, shiftId, dateStr) => {
  if (!company) return null;
  const branch = (company.branches || []).find((b) => oid(b.branchId) === branchId);
  const shift = (branch?.shifts || []).find(
    (s) => oid(s.shiftId) === shiftId && s.isActive !== false
  );
  if (!shift) return null;
  const day = dayScheduleOf(shift.monthlySchedule, dateStr);
  if (!day || day.isOff) return { isOff: true, startTime: "", endTime: "" };
  const clock = sameDayClock(day.startTime, day.endTime);
  return { isOff: false, startTime: clock.startTime || "", endTime: clock.endTime || "" };
};

const classifyPunch = (att, emp, companies) => {
  const companyId = oid(att.companyId) || userCompanyIds(emp)[0] || "";
  const company = companies.get(companyId) || null;
  const branchId = oid(att.branchId) || oid(emp?.official?.branchId);
  const shiftId = oid(att.shift) || oid(emp?.official?.shiftId);
  const clock = dayClock(company?.doc, branchId, shiftId, att.date);
  const startMin = parseHm(clock?.startTime);
  const punchMin = att.punchIn ? minutesOfDay(att.punchIn) : null;
  const window =
    punchMin != null && startMin != null
      ? punchInWindow(punchMin, startMin, DEFAULT_SHIFT.graceMinutes)
      : null;
  const isLate = window ? window.isLate : (Number(att.lateByMinutes) || 0) > 0;
  const isEarly = window ? window.isEarly : false;
  const reviewed = att.attendanceStatus === "Approved" || att.attendanceStatus === "Rejected";
  let attendanceStatus = null;
  if (!att.punchIn) attendanceStatus = null;
  else if (reviewed) attendanceStatus = att.attendanceStatus;
  else if (isLate) attendanceStatus = "Late";
  else if (isEarly) attendanceStatus = "Early";
  else attendanceStatus = "On time";
  const status = isLate ? "Late" : isEarly ? "Early" : att.punchIn ? "On time" : "Absent";
  return {
    isLate,
    isEarly,
    lateByMinutes: window ? window.lateByMinutes : isLate ? Number(att.lateByMinutes) || 0 : 0,
    earlyByMinutes: window ? window.earlyByMinutes : 0,
    attendanceStatus,
    status,
    startTime: clock?.startTime || "",
    endTime: clock?.endTime || "",
    company: company ? { _id: company._id, companyName: company.companyName } : null,
    shiftId,
    branchId,
  };
};

/**
 * LIST — GET /api/attendance/late-early
 * One call for Late Arrivals and Early Arrivals.
 * type=late | early | all
 * Company, search, department, branch, shift, date, page, limit.
 * isLate / isEarly come from punch-in vs that day's shift start + 10 min grace.
 */
const listLateEarly = async (req, res) => {
  try {
    const type = String(req.query.type || "all").toLowerCase();
    if (!["late", "early", "all"].includes(type)) {
      return res.status(400).json({ message: 'type must be "late", "early", or "all"' });
    }

    let from = req.query.from;
    let to = req.query.to;
    const date = req.query.date || todayDate();
    if (!from && !to) {
      from = date;
      to = date;
    } else {
      if (!from) from = to;
      if (!to) to = from;
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 200);
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
    const q = String(req.query.search || "").trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const clause = {
        $or: [
          { name: rx },
          { "official.employeeCode": rx },
          { "official.officialEmail": rx },
        ],
      };
      if (empFilter.$or) {
        empFilter.$and = [{ $or: empFilter.$or }, clause];
        delete empFilter.$or;
      } else {
        empFilter.$or = clause.$or;
      }
    }

    const employees = await User.find(empFilter)
      .select(
        "name official.employeeCode official.officialEmail official.department official.designation official.branchId official.shiftId official.companyIds"
      )
      .lean();
    const empById = new Map(employees.map((e) => [oid(e._id), e]));
    const empIds = employees.map((e) => e._id);

    const empty = {
      type,
      from,
      to,
      companyId: companyScope.companyId || null,
      counts: { late: 0, early: 0, all: 0 },
      total: 0,
      page,
      limit,
      pages: 1,
      filters: {
        type,
        date: req.query.date || date,
        from,
        to,
        search: req.query.search || "",
        department: req.query.department || "ALL",
        branchId: req.query.branchId || "ALL",
        shiftId: req.query.shiftId || "ALL",
        companyId: companyScope.companyId || "ALL",
      },
      data: [],
    };
    if (!empIds.length) return res.json(empty);

    const records = await Attendance.find({
      employee: { $in: empIds },
      date: { $gte: from, $lte: to },
      punchIn: { $ne: null },
    })
      .select(
        "employee date shift branchId companyId punchIn punchOut punchInSource punchOutSource workMode workedMinutes lateByMinutes earlyByMinutes status remarks attendanceStatus"
      )
      .lean();

    const companyIds = [
      ...records.map((r) => oid(r.companyId)),
      ...employees.flatMap((e) => userCompanyIds(e)),
    ].filter(Boolean);
    const companyDocs = companyIds.length
      ? await Company.find({ _id: { $in: [...new Set(companyIds)] } })
          .select("companyName branches")
          .lean()
      : [];
    const companies = new Map(
      companyDocs.map((c) => [oid(c._id), { _id: c._id, companyName: c.companyName || "", doc: c }])
    );

    const allRows = [];
    for (const att of records) {
      const emp = empById.get(oid(att.employee));
      allRows.push({ att, emp, timing: classifyPunch(att, emp, companies) });
    }
    const classified = allRows.filter((r) => {
      if (type === "late") return r.timing.isLate;
      if (type === "early") return r.timing.isEarly;
      return r.timing.isLate || r.timing.isEarly;
    });

    classified.sort((a, b) => {
      if (a.att.date !== b.att.date) return a.att.date < b.att.date ? 1 : -1;
      return (b.timing.lateByMinutes || b.timing.earlyByMinutes) - (a.timing.lateByMinutes || a.timing.earlyByMinutes);
    });

    const late = allRows.filter((r) => r.timing.isLate).length;
    const early = allRows.filter((r) => r.timing.isEarly).length;
    const pageRows = classified.slice(skip, skip + limit);

    const shiftIds = pageRows.map((r) => r.timing.shiftId);
    const branchIds = pageRows.map((r) => r.timing.branchId);
    const [shifts, branches] = await Promise.all([
      loadMasterMap("shift", shiftIds),
      loadMasterMap("branch", branchIds),
    ]);

    const data = pageRows.map(({ att, emp, timing }) =>
      toListRow(att, emp, shifts.get(timing.shiftId) || null, branches.get(timing.branchId) || null, timing)
    );

    return res.json({
      ...empty,
      counts: {
        late,
        early,
        all: allRows.filter((r) => r.timing.isLate || r.timing.isEarly).length,
      },
      total: classified.length,
      pages: Math.max(1, Math.ceil(classified.length / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DETAIL — GET /api/attendance/late-early/:id
 * One record. Same late/early numbers as the list.
 */
const getLateEarlyDetail = async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id)
      .populate(
        "employee",
        "name role official.employeeCode official.officialEmail official.department official.designation official.branchId official.shiftId official.companyIds"
      )
      .lean();

    if (!record) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const emp = record.employee;
    const empId = emp?._id || record.employee;
    const companyId = oid(record.companyId) || userCompanyIds(emp)[0] || "";
    const shiftId = oid(record.shift) || oid(emp?.official?.shiftId);
    const branchId = oid(record.branchId) || oid(emp?.official?.branchId);

    const accessCheck = async () => {
      if (hasGlobalCompanyAccess(req.user)) return null;
      if (isTeamScopedRole(normalizeRoleName(req.user.role))) {
        const onTeam = await User.exists({
          _id: empId,
          ...teamMemberFilter(req.user),
        });
        if (!onTeam) return "Access denied";
      } else {
        const mine = new Set(managementCompanyIds(req.user));
        const theirs = userCompanyIds(emp || {});
        if (!theirs.some((id) => mine.has(id))) return "Access denied";
      }
      return null;
    };

    const [accessErr, companyDoc, shiftMap, branchMap] = await Promise.all([
      accessCheck(),
      companyId
        ? Company.findById(companyId).select("companyName branches").lean()
        : null,
      loadMasterMap("shift", [shiftId]),
      loadMasterMap("branch", [branchId]),
    ]);
    if (accessErr) return res.status(403).json({ message: accessErr });

    const companies = new Map();
    if (companyDoc) {
      companies.set(oid(companyDoc._id), {
        _id: companyDoc._id,
        companyName: companyDoc.companyName || "",
        doc: companyDoc,
      });
    }
    const timing = classifyPunch(record, emp, companies);
    const shiftMaster = shiftMap.get(shiftId) || null;
    const branchMaster = branchMap.get(branchId) || null;
    const worked = Number(record.workedMinutes) || 0;
    const overtime = overtimeAfterShiftEnd(record.punchOut, timing.endTime);
    const breakMins = breakMinutesOf(record);

    return res.json({
      ...toListRow(record, emp, shiftMaster, branchMaster, timing),
      punch: {
        punchInTime: record.punchIn ? formatPunchStamp(record.punchIn) : "",
        punchOutTime: record.punchOut ? formatPunchStamp(record.punchOut) : "",
        totalHours: formatDurationLabel(worked),
        workedMinutes: worked,
      },
      workInfo: {
        department: emp?.official?.department || "",
        location: branchMaster?.name || "",
        branch: branchMaster,
        company: timing.company,
        shift: shiftMaster
          ? { ...shiftMaster, startTime: timing.startTime || "", endTime: timing.endTime || "" }
          : null,
        workMode: record.workMode || "WFO",
      },
      timeline: buildTimeline(record),
      summary: {
        shiftStart: timing.startTime || "",
        shiftEnd: timing.endTime || "",
        shiftTiming:
          timing.startTime || timing.endTime
            ? `${timing.startTime || ""} – ${timing.endTime || ""}`
            : "",
        breakDuration: minutesLabel(breakMins),
        breakMinutes: breakMins,
        lateBy: minutesLabel(timing.lateByMinutes),
        lateByMinutes: timing.lateByMinutes,
        earlyBy: minutesLabel(timing.earlyByMinutes),
        earlyByMinutes: timing.earlyByMinutes,
        isLate: timing.isLate,
        isEarly: timing.isEarly,
        overtime: formatDurationLabel(overtime),
        overtimeMinutes: overtime,
      },
      reviewReason: String(record.reviewReason || "").trim(),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listLateEarly,
  getLateEarlyDetail,
};
