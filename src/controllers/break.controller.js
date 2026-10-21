/**
 * BREAK CONTROLLER — /api/break
 *
 * Employee (any login, own row only):
 *   POST /start   POST /end   GET /me
 *
 * Admin:
 *   Live Break Status   GET /live
 *   Break History       GET /history
 *
 * Employee sees only the published policies (2 max): Lunch, and a flexible break with no daily count.
 * Ending past that policy's minutes is Pending until the reporting manager reviews it.
 * Must be punched in. Punch out is blocked while a break is open.
 */
const BreakSession = require("../models/Break");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const { todayDate, getAssignedShift, workProgress, computeDayMetrics } = require("../utils/shiftTiming");
const {
  companyFilter,
  hasGlobalCompanyAccess,
  userCompanyIds,
  escapeRegex,
} = require("../utils/companyScope");
const {
  teamMemberFilter,
  assertTeamOrCompanyEmployee,
} = require("../utils/teamScope");
const {
  EMPLOYEE,
  normalizeRoleName,
  isTeamScopedRole,
} = require("../config/roles");
const { logEmployeeActivity } = require("../utils/activityLog");
const BreakPolicy = require("../models/BreakPolicy");
const {
  MAX_PUBLISHED,
  publishedPolicies,
  findPublishedByName,
  publishedCount,
} = require("../utils/breakPolicy");

const COUNTED_STATUSES = ["Completed", "Approved", "Pending"];

const TZ = () => process.env.TZ || "Asia/Kolkata";

const clock12 = (date) => {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed
    .toLocaleTimeString("en-US", {
      timeZone: TZ(),
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\u202f/g, " ");
};

const dateLabel = (ymd) => {
  const day = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

const minsLabel = (n) =>
  Number.isFinite(n) && n >= 0 ? `${n}m` : "";

const elapsedMinutes = (startedAt, endedAt) => {
  if (!startedAt) return 0;
  const end = endedAt ? new Date(endedAt) : new Date();
  return Math.max(0, Math.floor((end - new Date(startedAt)) / 60000));
};

const employeeCard = (user) => ({
  _id: user?._id || null,
  name: user?.name || "",
  employeeCode: user?.official?.employeeCode || "",
  profileUrl: user?.profileUrl || "",
});

const pageOf = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const liveKey = (raw) => {
  const s = String(raw || "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "on_break" || s === "onbreak") return "on_break";
  if (s === "at_desk" || s === "atdesk") return "at_desk";
  if (s === "overdue") return "overdue";
  return "all";
};

const historyKey = (raw) => {
  const s = String(raw || "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "completed") return "Completed";
  if (s === "pending") return "Pending";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "exceeded") return "Pending";
  return "all";
};

/** Status values the live board and history use. At Desk is not saved on a break. */
const BREAK_STATUSES = [
  "On Break",
  "At Desk",
  "Overdue",
  "Completed",
  "Pending",
  "Approved",
  "Rejected",
];

/**
 * Write Overdue when this open break passes the balance it started with.
 */
const storeOpenStatus = async (session) => {
  if (!session || session.endedAt) return session;
  let next = "On Break";
  if (session.allowedMinutes != null) {
    const elapsed = elapsedMinutes(session.startedAt);
    if (elapsed > session.allowedMinutes) next = "Overdue";
  }
  if (session.status !== next) {
    session.status = next;
    await session.save();
  }
  return session;
};

/** Employees this admin can see. null filter means nobody. */
const buildEmployeeFilter = (actor, query) => {
  const filter = {
    role: { $in: [EMPLOYEE, "Employee"] },
    status: { $ne: "Deleted" },
  };

  if (!hasGlobalCompanyAccess(actor)) {
    if (isTeamScopedRole(normalizeRoleName(actor.role))) {
      Object.assign(filter, teamMemberFilter(actor));
    } else {
      const scoped = companyFilter(actor);
      if (scoped === false) return { _id: { $in: [] } };
      if (scoped) Object.assign(filter, scoped);
    }
  }

  const companyId = String(query.companyId || "").trim();
  if (companyId && companyId !== "ALL") {
    if (!hasGlobalCompanyAccess(actor)) {
      const mine = userCompanyIds(actor);
      if (mine.length && !mine.map(String).includes(companyId)) {
        return { _id: { $in: [] } };
      }
    }
    filter["official.companyIds"] = companyId;
  }

  const department = String(query.department || "").trim();
  if (department && department.toUpperCase() !== "ALL") {
    filter["official.department"] = new RegExp(`^${escapeRegex(department)}$`, "i");
  }

  const shiftId = String(query.shiftId || "").trim();
  if (shiftId && shiftId.toUpperCase() !== "ALL") {
    filter["official.shiftId"] = shiftId;
  }

  const search = String(query.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const clause = {
      $or: [{ name: rx }, { "official.employeeCode": rx }],
    };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, clause];
      delete filter.$or;
    } else {
      Object.assign(filter, clause);
    }
  }

  return filter;
};

const shiftNameMap = async (ids) => {
  const unique = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await getModel("shift").find({ _id: { $in: unique } }).select("name").lean();
  return new Map(rows.map((row) => [String(row._id), row.name || ""]));
};

/** Approve / Reject only for a Pending break, and only for HR or that person's reporting manager. */
const canReviewBreak = (actor, employee, status) => {
  if (status !== "Pending" || !actor || !employee) return false;
  if (normalizeRoleName(actor.role) === EMPLOYEE) return false;
  if (String(actor._id) === String(employee._id)) return false;
  return !assertTeamOrCompanyEmployee(actor, employee);
};

const closeStatus = (duration, allowed) => {
  if (allowed == null) return "Completed";
  if (duration > allowed) return "Pending";
  return "Completed";
};

/** Minutes of one policy already used today. Flexible breaks are not pooled. */
const usedOfType = async (employeeId, date, breakType) => {
  const rows = await BreakSession.find({
    employee: employeeId,
    date,
    breakType,
    status: { $in: COUNTED_STATUSES },
  })
    .select("durationMinutes")
    .lean();
  return rows.reduce((sum, row) => sum + (row.durationMinutes || 0), 0);
};

/** Employee sees published policies only. No count of how many times they went. */
const policiesForEmployee = async (employeeId, date) => {
  const rows = await publishedPolicies();
  const list = [];
  for (const row of rows) {
    if (row.flexible) {
      list.push({ name: row.name, flexible: true });
      continue;
    }
    const used = await usedOfType(employeeId, date, row.name);
    const minutes = row.minutes || 0;
    list.push({
      name: row.name,
      minutes,
      remainingMinutes: Math.max(0, minutes - used),
    });
  }
  return list;
};

/** Minutes already taken today, including a break that is still open. */
const takenToday = async (employeeId, date) => {
  const rows = await BreakSession.find({ employee: employeeId, date })
    .select("startedAt endedAt durationMinutes")
    .lean();
  let minutes = 0;
  for (const row of rows) {
    minutes += row.endedAt ? row.durationMinutes || 0 : elapsedMinutes(row.startedAt);
  }
  return { count: rows.length, minutes };
};

const companyIdOf = (user, attendance) =>
  attendance?.companyId || user?.official?.companyIds?.[0] || null;

/** Keep attendance.breaks in step so worked-time still subtracts the break. */
const pushAttendanceBreak = async (employeeId, date, startedAt) => {
  const record = await Attendance.findOne({ employee: employeeId, date });
  if (!record) return;
  record.breaks.push({ start: startedAt, end: null });
  record.markModified("breaks");
  await record.save();
};

const closeAttendanceBreak = async (employeeId, date, endedAt) => {
  const record = await Attendance.findOne({ employee: employeeId, date });
  if (!record) return;
  const list = record.breaks || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].start && !list[i].end) {
      list[i].end = endedAt;
      break;
    }
  }
  record.markModified("breaks");
  await record.save();
};

const finishSession = async (session, endedBy, actorId) => {
  const now = new Date();
  const duration = elapsedMinutes(session.startedAt, now);
  session.endedAt = now;
  session.durationMinutes = duration;
  session.status = closeStatus(duration, session.allowedMinutes);
  session.endedBy = endedBy;
  session.endedByUser = actorId || null;
  await session.save();
  await closeAttendanceBreak(session.employee, session.date, now);
  return session;
};

/** Activity row: who took which break, and how many minutes they have used today. */
const logBreakActivity = async (actor, employee, session) => {
  const today = await takenToday(session.employee, session.date);
  const open = !session.endedAt;
  const who = employee?.name || "Employee";
  const summary = open
    ? `${who} started ${session.breakType}`
    : session.status === "Pending"
      ? `${who} ended ${session.breakType} after ${session.durationMinutes}m. Past today's balance — waiting for reporting manager`
      : `${who} ended ${session.breakType} after ${session.durationMinutes}m. Today ${today.minutes}m in ${today.count} breaks`;
  await logEmployeeActivity({
    actor,
    employee,
    action: open ? "create" : "update",
    section: "break",
    summary,
    changes: [
      { field: "break.type", label: "Break", from: null, to: session.breakType },
      {
        field: "break.duration",
        label: "Duration",
        from: null,
        to: open ? "Started" : `${session.durationMinutes}m`,
      },
      { field: "break.today", label: "Today", from: null, to: `${today.minutes}m` },
    ],
    meta: {
      breakId: session._id,
      breakType: session.breakType,
      status: session.status,
      durationMinutes: session.durationMinutes || 0,
      todayMinutes: today.minutes,
      todayBreaks: today.count,
    },
  });
};

/** What the employee sees. No department, shift, ids, or duplicate time fields. */
const employeeBreak = (session) => {
  if (!session) return null;
  const open = !session.endedAt;
  const minutes = open ? elapsedMinutes(session.startedAt) : session.durationMinutes || 0;
  const card = {
    breakType: session.breakType,
    startedAt: clock12(session.startedAt),
    minutes,
    status: session.status,
  };
  if (open) card.allowedMinutes = session.allowedMinutes;
  else card.endedAt = clock12(session.endedAt);
  return card;
};

const employeePayload = async (user, attendance, session, message) => {
  const date = attendance?.date || session?.date || todayDate();
  const punchedIn = Boolean(attendance?.punchIn);
  const punchedOut = Boolean(attendance?.punchOut);
  const onBreak = Boolean(session && !session.endedAt);
  const body = {
    date,
    canStart: punchedIn && !punchedOut && !onBreak,
    canEnd: onBreak,
    policies: await policiesForEmployee(user._id, date),
    break: employeeBreak(session),
  };
  if (message) return { message, ...body };
  return body;
};

const breakCard = (session, user) => {
  const open = !session.endedAt;
  const duration = open
    ? elapsedMinutes(session.startedAt)
    : session.durationMinutes;
  return {
    _id: session._id,
    breakType: session.breakType,
    date: session.date,
    dateLabel: dateLabel(session.date),
    startedAt: session.startedAt,
    startedAtLabel: clock12(session.startedAt),
    endedAt: session.endedAt,
    endedAtLabel: clock12(session.endedAt),
    elapsedMinutes: duration,
    elapsed: minsLabel(duration),
    allowedMinutes: session.allowedMinutes,
    allowed: session.allowedMinutes == null ? "" : minsLabel(session.allowedMinutes),
    status: session.status,
    department: session.department || user?.official?.department || "",
    shift: {
      _id: session.shiftId || user?.official?.shiftId || null,
      name: session.shiftName || "",
    },
  };
};

/**
 * GET /api/break/me
 * Dashboard button: can the logged-in person start or end a break.
 */
/** Every break this person has taken, newest day first, split by type. */
const breakHistoryFor = async (employeeId) => {
  const rows = await BreakSession.find({ employee: employeeId })
    .select("breakType status date startedAt endedAt durationMinutes")
    .sort({ date: -1, startedAt: 1 })
    .lean();

  const byDate = new Map();
  for (const row of rows) {
    const minutes = row.endedAt ? row.durationMinutes || 0 : elapsedMinutes(row.startedAt);
    let day = byDate.get(row.date);
    if (!day) {
      day = {
        date: row.date,
        dateLabel: dateLabel(row.date),
        count: 0,
        minutes: 0,
        splits: new Map(),
        breaks: [],
      };
      byDate.set(row.date, day);
    }
    day.count += 1;
    day.minutes += minutes;
    const type = row.breakType || "Break";
    const split = day.splits.get(type) || { breakType: type, count: 0, minutes: 0 };
    split.count += 1;
    split.minutes += minutes;
    day.splits.set(type, split);
    day.breaks.push({
      breakType: type,
      startedAt: clock12(row.startedAt),
      endedAt: row.endedAt ? clock12(row.endedAt) : "",
      minutes,
      status: row.status,
    });
  }

  return [...byDate.values()].map((day) => ({
    date: day.date,
    dateLabel: day.dateLabel,
    count: day.count,
    minutes: day.minutes,
    splits: [...day.splits.values()],
    breaks: day.breaks,
  }));
};

const myBreak = async (req, res) => {
  try {
    const date = todayDate();
    const employeeId = req.user._id;
    const attendance = await Attendance.findOne({ employee: employeeId, date }).select(
      "punchIn punchOut companyId"
    );
    const open = await storeOpenStatus(
      await BreakSession.findOne({ employee: employeeId, date, endedAt: null })
    );
    const body = await employeePayload(req.user, attendance, open);
    const history = await breakHistoryFor(employeeId);
    const today = history.find((day) => day.date === date) || {
      date,
      dateLabel: dateLabel(date),
      count: 0,
      minutes: 0,
      splits: [],
      breaks: [],
    };
    body.today = {
      count: today.count,
      minutes: today.minutes,
      splits: today.splits,
    };
    body.history = history;
    return res.json(body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/start
 * Body: { breakType: "Lunch Break" | "Day Break" }
 */
const startBreak = async (req, res) => {
  try {
    const date = todayDate();
    const employeeId = req.user._id;
    const attendance = await Attendance.findOne({ employee: employeeId, date });

    if (!attendance?.punchIn) {
      return res.status(400).json({ message: "Punch in before starting a break" });
    }
    if (attendance.punchOut) {
      return res.status(400).json({ message: "You have already punched out today" });
    }

    const user = await User.findById(employeeId).select(
      "name role profileUrl official.employeeCode official.officialEmail official.department official.designation official.shiftId official.companyIds"
    );
    const policy = await findPublishedByName(req.body.breakType);
    if (!policy) {
      return res.status(400).json({ message: "This break is not available" });
    }
    let allowedMinutes;
    if (policy.flexible) {
      const picked = Number(req.body.minutes);
      if (!Number.isInteger(picked) || picked < 1) {
        return res.status(400).json({ message: "Enter minutes, for example 5 or 10" });
      }
      allowedMinutes = picked;
    } else {
      const used = await usedOfType(employeeId, date, policy.name);
      allowedMinutes = Math.max(0, (policy.minutes || 0) - used);
    }

    const open = await BreakSession.findOne({ employee: employeeId, endedAt: null }).select("_id");
    if (open) {
      return res.status(400).json({ message: "You are already on a break" });
    }

    const shiftId = user?.official?.shiftId || null;
    let shiftName = "";
    if (shiftId) {
      const shift = await getModel("shift").findById(shiftId).select("name").lean();
      shiftName = shift?.name || "";
    }

    const companyId = companyIdOf(user, attendance);
    const now = new Date();
    const session = new BreakSession({
      employee: employeeId,
      companyId,
      department: user?.official?.department || "",
      shiftId,
      shiftName,
      breakType: policy.name,
      date,
      startedAt: now,
      allowedMinutes,
      status: "On Break",
    });

    try {
      await session.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ message: "You are already on a break" });
      }
      throw err;
    }

    await pushAttendanceBreak(employeeId, date, now);
    await logBreakActivity(req.user, user, session);

    return res.status(201).json(
      await employeePayload(
        user,
        attendance,
        session,
        allowedMinutes > 0
          ? "Break started"
          : "Break started. This policy's time is already used, so ending it will need reporting manager approval"
      )
    );
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/end
 * Closes the logged-in person's open break.
 */
const endMyBreak = async (req, res) => {
  try {
    const session = await BreakSession.findOne({
      employee: req.user._id,
      endedAt: null,
    });
    if (!session) {
      return res.status(400).json({ message: "You are not on a break" });
    }

    await finishSession(session, "employee", req.user._id);
    const employee = await User.findById(req.user._id).select(
      "name role official.employeeCode official.officialEmail official.department official.designation official.companyIds"
    );
    await logBreakActivity(req.user, employee, session);
    const attendance = await Attendance.findOne({
      employee: req.user._id,
      date: session.date,
    }).select("punchIn punchOut companyId date");
    const body = await employeePayload(
      req.user,
      attendance,
      session,
      session.status === "Pending"
        ? "Break ended past today's balance. Waiting for reporting manager approval"
        : "Break ended"
    );
    const full = await Attendance.findOne({ employee: req.user._id, date: session.date });
    const { shift } = await getAssignedShift(req.user._id, session.date);
    const progress = workProgress(full, shift);
    if (full && !full.punchOut) {
      full.workedMinutes = progress.workedMinutes;
      await full.save();
    }
    const hours = (n) => {
      const v = Math.max(0, Math.round(Number(n) || 0));
      return `${Math.floor(v / 60)}h ${v % 60}m`;
    };
    body.break.minutes = session.durationMinutes;
    body.attendance = {
      breakMinutes: session.durationMinutes,
      breakMinutesToday: progress.breakMinutes,
      worked: hours(progress.workedMinutes),
      required: hours(progress.requiredMinutes),
      remaining: hours(progress.remainingMinutes),
      completed: progress.completed,
    };
    return res.json(body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/break/live
 * People punched in today: On Break, At Desk, or Overdue.
 */
const liveBreaks = async (req, res) => {
  try {
    const date = todayDate();
    const { page, limit, skip } = pageOf(req.query);
    const filter = buildEmployeeFilter(req.user, req.query);
    const employees = await User.find(filter)
      .select("name profileUrl role official.employeeCode official.department official.shiftId official.companyIds official.reportingHead1 official.reportingHead2")
      .lean();

    const ids = employees.map((row) => row._id);
    const [attendance, openBreaks, names] = await Promise.all([
      Attendance.find({
        date,
        employee: { $in: ids },
        punchIn: { $ne: null },
        punchOut: null,
      })
        .select("employee")
        .lean(),
      BreakSession.find({ date, employee: { $in: ids }, endedAt: null }),
      shiftNameMap(employees.map((row) => row.official?.shiftId)),
    ]);

    await Promise.all(openBreaks.map((session) => storeOpenStatus(session)));
    const inOffice = new Set(attendance.map((row) => String(row.employee)));
    const openByEmployee = new Map(openBreaks.map((row) => [String(row.employee), row]));
    const todayRows = await BreakSession.find({ date, employee: { $in: ids } })
      .select("employee breakType status startedAt endedAt durationMinutes")
      .sort({ startedAt: 1 })
      .lean();
    const todayByEmployee = new Map();
    for (const row of todayRows) {
      const key = String(row.employee);
      const prev = todayByEmployee.get(key) || { count: 0, minutes: 0, splits: new Map(), taken: [] };
      const minutes = row.endedAt ? row.durationMinutes || 0 : elapsedMinutes(row.startedAt);
      const breakType = row.breakType || "Break";
      prev.count += 1;
      prev.minutes += minutes;
      const split = prev.splits.get(breakType) || { breakType, count: 0, minutes: 0 };
      split.count += 1;
      split.minutes += minutes;
      prev.splits.set(breakType, split);
      prev.taken.push({
        _id: row._id,
        breakType,
        startedAt: clock12(row.startedAt),
        endedAt: row.endedAt ? clock12(row.endedAt) : "",
        minutes,
        status: row.status || "On Break",
        canReview: false,
      });
      todayByEmployee.set(key, prev);
    }

    const rows = [];
    for (const user of employees) {
      const id = String(user._id);
      if (!inOffice.has(id)) continue;
      const session = openByEmployee.get(id) || null;
      const status = session ? session.status : "At Desk";
      const today = todayByEmployee.get(id) || { count: 0, minutes: 0, splits: new Map(), taken: [] };
      const taken = today.taken || [];
      const row = {
        employee: employeeCard(user),
        department: user.official?.department || "",
        shift: {
          _id: user.official?.shiftId || null,
          name: names.get(String(user.official?.shiftId || "")) || session?.shiftName || "",
        },
        todayBreaks: today.count,
        todayMinutes: today.minutes,
        splits: [...(today.splits ? today.splits.values() : [])],
        taken,
        status,
      };
      if (session) {
        const elapsed = elapsedMinutes(session.startedAt);
        row._id = session._id;
        row.breakType = session.breakType;
        row.startedAt = session.startedAt;
        row.startedAtLabel = clock12(session.startedAt);
        row.elapsedMinutes = elapsed;
        row.elapsed = minsLabel(elapsed);
        if (session.allowedMinutes != null) {
          row.allowedMinutes = session.allowedMinutes;
          row.allowed = minsLabel(session.allowedMinutes);
        }
      } else if (taken.length) {
        const last = taken[taken.length - 1];
        row._id = last._id;
        row.breakType = last.breakType;
        row.startedAtLabel = last.startedAt;
        row.endedAtLabel = last.endedAt;
        row.minutes = last.minutes;
        row.breakStatus = last.status;
      }
      for (const item of taken) {
        item.canReview = canReviewBreak(req.user, user, item.status);
      }
      row.canReview = taken.some((item) => item.canReview);
      rows.push(row);
    }

    const counts = {
      all: rows.length,
      onBreak: rows.filter((row) => row.status === "On Break").length,
      atDesk: rows.filter((row) => row.status === "At Desk").length,
      overdue: rows.filter((row) => row.status === "Overdue").length,
    };

    const key = liveKey(req.query.status);
    const filtered =
      key === "all"
        ? rows
        : rows.filter((row) => liveKey(row.status) === key);

    const rank = { Overdue: 0, "On Break": 1, "At Desk": 2 };
    filtered.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        a.employee.name.localeCompare(b.employee.name)
    );

    return res.json({
      date,
      statuses: BREAK_STATUSES,
      counts,
      total: filtered.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(filtered.length / limit)),
      data: filtered.slice(skip, skip + limit),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/break/history
 * Ended breaks only. Status: Completed or Exceeded.
 */
const breakHistory = async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const people = await User.find(buildEmployeeFilter(req.user, req.query))
      .select("_id name profileUrl role official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2")
      .lean();
    const byId = new Map(people.map((row) => [String(row._id), row]));

    const query = {
      endedAt: { $ne: null },
      employee: { $in: people.map((row) => row._id) },
    };

    const breakType = String(req.query.breakType || "").trim();
    if (breakType && breakType.toUpperCase() !== "ALL") {
      query.breakType = new RegExp(`^${escapeRegex(breakType)}$`, "i");
    }

    const status = historyKey(req.query.status);
    if (status !== "all") query.status = status;

    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }

    const [total, sessions] = await Promise.all([
      BreakSession.countDocuments(query),
      BreakSession.find(query)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const data = sessions.map((session) => {
      const user = byId.get(String(session.employee));
      return {
        _id: session._id,
        employee: employeeCard(user),
        department: session.department || user?.official?.department || "",
        shift: { _id: session.shiftId || null, name: session.shiftName || "" },
        date: session.date,
        dateLabel: dateLabel(session.date),
        breakType: session.breakType,
        start: clock12(session.startedAt),
        end: clock12(session.endedAt),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMinutes: session.durationMinutes,
        duration: minsLabel(session.durationMinutes),
        allowedMinutes: session.allowedMinutes,
        status: session.status,
        canReview: canReviewBreak(req.user, user, session.status),
      };
    });

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/break/approvals
 * Breaks that ended past the daily balance and still need a decision.
 */
const pendingBreaks = async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const filter = buildEmployeeFilter(req.user, req.query);
    const employees = await User.find(filter)
      .select("_id name profileUrl role official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2")
      .lean();
    const ids = employees.map((row) => row._id);
    const query = { employee: { $in: ids }, status: "Pending" };
    if (req.query.from || req.query.to) {
      query.date = {};
      if (req.query.from) query.date.$gte = String(req.query.from).slice(0, 10);
      if (req.query.to) query.date.$lte = String(req.query.to).slice(0, 10);
    }

    const [total, sessions] = await Promise.all([
      BreakSession.countDocuments(query),
      BreakSession.find(query).sort({ endedAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    const byId = new Map(employees.map((row) => [String(row._id), row]));
    const data = sessions.map((session) => ({
      _id: session._id,
      employee: employeeCard(byId.get(String(session.employee))),
      department: session.department || "",
      date: session.date,
      breakType: session.breakType,
      start: clock12(session.startedAt),
      end: clock12(session.endedAt),
      durationMinutes: session.durationMinutes,
      duration: minsLabel(session.durationMinutes),
      allowedMinutes: session.allowedMinutes,
      status: session.status,
      canReview: canReviewBreak(req.user, byId.get(String(session.employee)), session.status),
    }));

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/:id/review
 * Body: { decision: "approve" | "reject", remarks? }
 * Reporting manager (or HR / admin) decides a Pending break.
 * Rejected minutes go back into today's balance.
 */
const reviewBreak = async (req, res) => {
  try {
    const session = await BreakSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Break not found" });
    if (session.status !== "Pending") {
      return res.status(400).json({ message: "Only a pending break can be reviewed" });
    }

    const employee = await User.findById(session.employee).select(
      "name role official.employeeCode official.officialEmail official.department official.designation official.companyIds official.reportingHead1 official.reportingHead2"
    );
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    if (String(req.user._id) === String(session.employee)) {
      return res.status(403).json({ message: "You cannot review your own break" });
    }
    const denied = assertTeamOrCompanyEmployee(req.user, employee);
    if (denied) return res.status(403).json({ message: denied });

    const approve = String(req.body.decision).toLowerCase() === "approve";
    session.status = approve ? "Approved" : "Rejected";
    session.reviewNote = String(req.body.remarks || "").trim();
    session.reviewedBy = req.user._id;
    session.reviewedAt = new Date();
    await session.save();

    const record = await Attendance.findOne({ employee: session.employee, date: session.date });
    let attendance = null;
    if (record) {
      const startMs = new Date(session.startedAt).getTime();
      let marked = false;
      for (const row of record.breaks || []) {
        if (!row?.start) continue;
        if (Math.abs(new Date(row.start).getTime() - startMs) < 60000) {
          row.approved = approve;
          marked = true;
        }
      }
      if (approve && !marked && session.endedAt) {
        record.breaks.push({ start: session.startedAt, end: session.endedAt, approved: true });
      }
      record.markModified("breaks");
      const { shift } = await getAssignedShift(session.employee, session.date);
      const previousStatus = record.status;
      if (record.punchIn && record.punchOut) {
        const metrics = computeDayMetrics(record, shift, record.date);
        record.workedMinutes = metrics.workedMinutes;
        record.overtimeMinutes = metrics.overtimeMinutes;
        record.lateByMinutes = metrics.lateByMinutes;
        record.earlyByMinutes = metrics.earlyByMinutes;
        record.status =
          approve && (previousStatus === "Present" || previousStatus === "Late")
            ? previousStatus
            : metrics.status;
      } else if (record.punchIn) {
        record.workedMinutes = workProgress(record, shift).workedMinutes;
      }
      await record.save();
      const progress = workProgress(record, shift);
      const hours = (n) => {
        const v = Math.max(0, Math.round(Number(n) || 0));
        return `${Math.floor(v / 60)}h ${v % 60}m`;
      };
      attendance = {
        breakMinutes: session.durationMinutes,
        worked: hours(progress.workedMinutes),
        required: hours(progress.requiredMinutes),
        remaining: hours(progress.remainingMinutes),
        status: record.status,
      };
    }

    await logBreakActivity(req.user, employee, session);

    return res.json({
      message: approve
        ? "Break approved. Time is saved. Present status is unchanged."
        : "Break rejected. Those minutes are back in the balance",
      break: breakCard(session, employee),
      attendance,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const policyCard = (row) => ({
  _id: row._id,
  name: row.name,
  minutes: row.flexible ? null : row.minutes,
  flexible: Boolean(row.flexible),
  published: Boolean(row.published),
  description: row.description || "",
});

const listPolicies = async (req, res) => {
  try {
    const rows = await BreakPolicy.find({ companyId: null, name: { $nin: [null, ""] } })
      .sort({ published: -1, flexible: 1, name: 1 })
      .lean();
    return res.json({
      maxPublished: MAX_PUBLISHED,
      data: rows.map(policyCard),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createPolicy = async (req, res) => {
  try {
    const flexible = Boolean(req.body.flexible);
    const name = String(req.body.name || "").trim();
    const taken = await BreakPolicy.findOne({
      companyId: null,
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    }).select("_id");
    if (taken) return res.status(400).json({ message: "A policy with this name already exists" });

    const row = await BreakPolicy.create({
      companyId: null,
      name,
      flexible,
      minutes: flexible ? null : Number(req.body.minutes),
      published: false,
      description: String(req.body.description || "").trim(),
    });
    return res.status(201).json({ message: "Policy saved. Publish it to show it to employees", policy: policyCard(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updatePolicy = async (req, res) => {
  try {
    const row = await BreakPolicy.findById(req.params.id);
    if (!row || !row.name) return res.status(404).json({ message: "Policy not found" });

    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      const taken = await BreakPolicy.findOne({
        companyId: null,
        _id: { $ne: row._id },
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      }).select("_id");
      if (taken) return res.status(400).json({ message: "A policy with this name already exists" });
      row.name = name;
    }
    if (req.body.flexible != null) row.flexible = Boolean(req.body.flexible);
    if (row.flexible) row.minutes = null;
    else if (req.body.minutes != null) row.minutes = Number(req.body.minutes);
    if (req.body.description != null) row.description = String(req.body.description).trim();
    if (!row.flexible && (row.minutes == null || row.minutes < 1)) {
      return res.status(400).json({ message: "minutes is required when the break is not flexible" });
    }
    await row.save();
    return res.json({ message: "Policy updated", policy: policyCard(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const publishPolicy = async (req, res) => {
  try {
    const row = await BreakPolicy.findById(req.params.id);
    if (!row || !row.name) return res.status(404).json({ message: "Policy not found" });
    const publish = Boolean(req.body.published);
    if (publish && !row.published) {
      const count = await publishedCount(row._id);
      if (count >= MAX_PUBLISHED) {
        return res.status(400).json({
          message: "Only 2 policies can be published. Unpublish one first",
        });
      }
    }
    row.published = publish;
    await row.save();
    return res.json({
      message: publish ? "Policy published. Employees can use it" : "Policy unpublished",
      policy: policyCard(row),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deletePolicy = async (req, res) => {
  try {
    const row = await BreakPolicy.findById(req.params.id);
    if (!row || !row.name) return res.status(404).json({ message: "Policy not found" });
    if (row.published) {
      return res.status(400).json({ message: "Unpublish the policy before deleting it" });
    }
    await row.deleteOne();
    return res.json({ message: "Policy deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  myBreak,
  startBreak,
  endMyBreak,
  liveBreaks,
  breakHistory,
  pendingBreaks,
  reviewBreak,
  listPolicies,
  createPolicy,
  updatePolicy,
  publishPolicy,
  deletePolicy,
};
