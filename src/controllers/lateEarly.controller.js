/**
 * LATE & EARLY DEPARTURES — /api/attendance/late-early
 *
 * UI tabs:
 *   - Late Arrivals   → lateByMinutes > 0
 *   - Early Departures → earlyByMinutes > 0
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
const {
  todayDate, // YYYY-MM-DD today
  getAssignedShift, // read shift timings for detail panel
  formatPunchStamp, // "09:24" clock
} = require("../utils/shiftTiming");
const {
  formatDurationLabel, // "11m" / "9h 18m"
  oid, // id → string
  companySummary,
  branchSummary,
  shiftSummary,
} = require("../utils/attendanceFormat");
const {
  companyFilter, // HR scoped to their companies
  hasGlobalCompanyAccess, // Super Admin / Admin → all
  userCompanyIds,
  managementCompanyIds,
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
const toListRow = (att, emp, shiftMaster, branchMaster) => {
  const late = Number(att.lateByMinutes) || 0;
  const early = Number(att.earlyByMinutes) || 0;
  const worked = Number(att.workedMinutes) || 0;

  // Status badge text for UI chips
  let status = "On Time";
  if (late > 0 && early > 0) status = "Late & Early";
  else if (late > 0) status = "Late";
  else if (early > 0) status = "Early Departure";

  return {
    _id: att._id,
    date: att.date,
    employee: {
      _id: emp?._id || att.employee,
      name: emp?.name || "",
      official: {
        employeeCode: emp?.official?.employeeCode || "",
        department: emp?.official?.department || "",
        designation: emp?.official?.designation || "",
      },
    },
    department: emp?.official?.department || "",
    branch: branchMaster || null,
    location: branchMaster?.name || "", // UI "Location" column / detail
    shift: shiftMaster || null,
    punchIn: att.punchIn || null,
    punchOut: att.punchOut || null,
    punchInTime: att.punchIn ? formatPunchStamp(att.punchIn) : "",
    punchOutTime: att.punchOut ? formatPunchStamp(att.punchOut) : "",
    lateByMinutes: late,
    lateBy: minutesLabel(late),
    earlyByMinutes: early,
    earlyBy: minutesLabel(early),
    workedMinutes: worked,
    workingHours: formatDurationLabel(worked),
    status,
    verification: att.punchInSource || att.punchOutSource || null,
    workMode: att.workMode || "WFO",
    remarks: att.remarks || "",
    reason: att.remarks || "",
  };
};

/**
 * LIST — GET /api/attendance/late-early
 *
 * Query:
 *   type=late|early|all   (default late)
 *   date=YYYY-MM-DD       (default today)  OR from=&to=
 *   search= name / emp code
 *   department= / shiftId= / companyId=
 *   page= / limit=
 */
const listLateEarly = async (req, res) => {
  try {
    // Which tab: late arrivals vs early departures
    const type = String(req.query.type || "late").toLowerCase();
    if (!["late", "early", "all"].includes(type)) {
      return res.status(400).json({
        message: 'type must be "late", "early", or "all"',
      });
    }

    // Date range (single day by default = today)
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

    // Pagination
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 10, 200);
    const skip = (page - 1) * limit;

    // Employee scope + optional filters (search / dept / shift)
    const empFilter = scopedEmployeeFilter(req.user);

    if (req.query.department && req.query.department !== "ALL") {
      empFilter["official.department"] = req.query.department;
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
        ];
      }
    }

    // Ids only for scope — full employee cards loaded for the page
    const empIds = await User.distinct("_id", empFilter);

    if (!empIds.length) {
      return res.json({
        type,
        from,
        to,
        counts: { late: 0, early: 0, all: 0 },
        total: 0,
        page,
        limit,
        pages: 1,
        data: [],
      });
    }

    const attFilter = {
      employee: { $in: empIds },
      date: { $gte: from, $lte: to },
    };
    if (type === "late") attFilter.lateByMinutes = { $gt: 0 };
    else if (type === "early") attFilter.earlyByMinutes = { $gt: 0 };
    else {
      attFilter.$or = [
        { lateByMinutes: { $gt: 0 } },
        { earlyByMinutes: { $gt: 0 } },
      ];
    }

    const baseScope = {
      employee: { $in: empIds },
      date: { $gte: from, $lte: to },
    };

    const [lateCount, earlyCount, total, rows] = await Promise.all([
      Attendance.countDocuments({ ...baseScope, lateByMinutes: { $gt: 0 } }),
      Attendance.countDocuments({ ...baseScope, earlyByMinutes: { $gt: 0 } }),
      Attendance.countDocuments(attFilter),
      Attendance.find(attFilter)
        .select(
          "employee date shift branchId companyId punchIn punchOut punchInSource workMode workedMinutes lateByMinutes earlyByMinutes status remarks"
        )
        .sort({ date: -1, lateByMinutes: -1, earlyByMinutes: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const pageEmpIds = [...new Set(rows.map((r) => oid(r.employee)).filter(Boolean))];
    const employees = pageEmpIds.length
      ? await User.find({ _id: { $in: pageEmpIds } })
          .select(
            "name official.employeeCode official.department official.designation official.branchId official.shiftId official.companyIds"
          )
          .lean()
      : [];
    const empById = new Map(employees.map((e) => [oid(e._id), e]));

    const shiftIds = [
      ...rows.map((r) => oid(r.shift)),
      ...employees.map((e) => oid(e.official?.shiftId)),
    ];
    const branchIds = [
      ...rows.map((r) => oid(r.branchId)),
      ...employees.map((e) => oid(e.official?.branchId)),
    ];
    const [shifts, branches] = await Promise.all([
      loadMasterMap("shift", shiftIds),
      loadMasterMap("branch", branchIds),
    ]);

    const data = rows.map((att) => {
      const emp = empById.get(oid(att.employee));
      const shiftId = oid(att.shift) || oid(emp?.official?.shiftId);
      const branchId = oid(att.branchId) || oid(emp?.official?.branchId);
      return toListRow(
        att,
        emp,
        shifts.get(shiftId) || null,
        branches.get(branchId) || null
      );
    });

    return res.json({
      type,
      from,
      to,
      counts: {
        late: lateCount,
        early: earlyCount,
        all: lateCount + earlyCount,
      },
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        type,
        date: req.query.date || "",
        from,
        to,
        search: req.query.search || "",
        department: req.query.department || "ALL",
        shiftId: req.query.shiftId || "ALL",
        companyId: req.query.companyId || "ALL",
      },
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DETAIL — GET /api/attendance/late-early/:id
 * Side drawer: punches, timeline, shift timing, late/early summary.
 */
const getLateEarlyDetail = async (req, res) => {
  try {
    // Load attendance + employee for the drawer header
    const record = await Attendance.findById(req.params.id)
      .populate(
        "employee",
        "name role official.employeeCode official.department official.designation official.branchId official.shiftId official.companyIds"
      )
      .lean();

    if (!record) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const emp = record.employee;
    const empId = emp?._id || record.employee;

    // Access check + shift + masters in parallel
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
        const theirs = userCompanyIds(record.employee || {});
        if (!theirs.some((id) => mine.has(id))) return "Access denied";
      }
      return null;
    };

    const [accessErr, placed, shiftMap, branchMap] = await Promise.all([
      accessCheck(),
      getAssignedShift(empId, record.date),
      loadMasterMap("shift", [oid(record.shift) || oid(emp?.official?.shiftId)]),
      loadMasterMap("branch", [oid(record.branchId) || oid(emp?.official?.branchId)]),
    ]);
    if (accessErr) return res.status(403).json({ message: accessErr });
    const { shift, company, branch } = placed;
    const shiftMaster =
      shiftMap.get(oid(record.shift) || oid(emp?.official?.shiftId)) ||
      shiftSummary(shift);
    const branchMaster =
      branchMap.get(oid(record.branchId) || oid(emp?.official?.branchId)) ||
      branchSummary(branch);

    const late = Number(record.lateByMinutes) || 0;
    const early = Number(record.earlyByMinutes) || 0;
    const worked = Number(record.workedMinutes) || 0;
    const breakMins = breakMinutesOf(record);

    // Status chip for drawer header
    let status = "On Time";
    if (late > 0 && early > 0) status = "Late & Early";
    else if (late > 0) status = "Late";
    else if (early > 0) status = "Early Departure";

    return res.json({
      _id: record._id,
      date: record.date,
      employee: {
        _id: emp?._id,
        name: emp?.name || "",
        official: {
          employeeCode: emp?.official?.employeeCode || "",
          department: emp?.official?.department || "",
          designation: emp?.official?.designation || "",
        },
      },
      status,
      verification: record.punchInSource || null,
      // Today's punch block
      punch: {
        punchIn: record.punchIn || null,
        punchOut: record.punchOut || null,
        punchInTime: record.punchIn ? formatPunchStamp(record.punchIn) : "",
        punchOutTime: record.punchOut ? formatPunchStamp(record.punchOut) : "",
        totalHours: formatDurationLabel(worked),
        workedMinutes: worked,
      },
      // Work info block
      workInfo: {
        department: emp?.official?.department || "",
        location: branchMaster?.name || "",
        branch: branchMaster,
        company: companySummary(company),
        shift: shiftMaster,
        workMode: record.workMode || "WFO",
      },
      // Punch timeline (in / breaks / out)
      timeline: buildTimeline(record),
      // Attendance summary footer
      summary: {
        shiftTiming: shift
          ? `${shift.startTime || ""} – ${shift.endTime || ""}`
          : "",
        shiftStart: shift?.startTime || "",
        shiftEnd: shift?.endTime || "",
        breakDuration: minutesLabel(breakMins),
        breakMinutes: breakMins,
        lateDuration: minutesLabel(late),
        lateByMinutes: late,
        earlyDuration: minutesLabel(early),
        earlyByMinutes: early,
        overtime: formatDurationLabel(Number(record.overtimeMinutes) || 0),
        overtimeMinutes: Number(record.overtimeMinutes) || 0,
      },
      remarks: record.remarks || "",
      reason: record.remarks || "",
      // Frontend can link these actions
      actions: {
        viewHistory: true,
        regularize: true,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * HISTORY — GET /api/attendance/late-early/:id/history
 * Past late/early days for the same employee (View History button).
 */
const getLateEarlyHistory = async (req, res) => {
  try {
    // Parent attendance row → find employee
    const parent = await Attendance.findById(req.params.id)
      .select("employee")
      .lean();
    if (!parent) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const rows = await Attendance.find({
      employee: parent.employee,
      $or: [{ lateByMinutes: { $gt: 0 } }, { earlyByMinutes: { $gt: 0 } }],
    })
      .select(
        "date punchIn punchOut lateByMinutes earlyByMinutes workedMinutes"
      )
      .sort({ date: -1 })
      .limit(limit)
      .lean();

    const data = rows.map((r) => ({
      _id: r._id,
      date: r.date,
      punchInTime: r.punchIn ? formatPunchStamp(r.punchIn) : "",
      punchOutTime: r.punchOut ? formatPunchStamp(r.punchOut) : "",
      lateByMinutes: Number(r.lateByMinutes) || 0,
      lateBy: minutesLabel(r.lateByMinutes),
      earlyByMinutes: Number(r.earlyByMinutes) || 0,
      earlyBy: minutesLabel(r.earlyByMinutes),
      workingHours: formatDurationLabel(r.workedMinutes),
      status:
        (Number(r.lateByMinutes) || 0) > 0 &&
        (Number(r.earlyByMinutes) || 0) > 0
          ? "Late & Early"
          : (Number(r.lateByMinutes) || 0) > 0
            ? "Late"
            : "Early Departure",
    }));

    return res.json({
      employeeId: parent.employee,
      total: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listLateEarly,
  getLateEarlyDetail,
  getLateEarlyHistory,
};
