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
 * Employee sees published policies. Fixed minutes come from live policy (e.g. Lunch 30 or 45).
 * POST /start auto-picks next fixed with remaining; Day Break needs day-request approval first.
 * End always Completes (no overage approve). Extra time → regularization if needed.
 * Day Break still needs day-request approval before start.
 * Must be punched in. Punch out is blocked while a break is open.
 */
const BreakSession = require("../models/Break");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const { todayDate, getAssignedShift, workProgress } = require("../utils/shiftTiming");
const {
  resolvePunchLocation,
  resolveOfficeLocation,
} = require("../utils/geocode");
const {
  assertWithinPunchRadius,
  PUNCH_RADIUS_METERS,
} = require("../utils/geoRadius");
const { isApprovedTourDuty } = require("../utils/attendanceDayStatus");
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
const BreakDayGrant = require("../models/BreakDayGrant");
const {
  publishedPolicies,
  findPublishedByName,
} = require("../utils/breakPolicy");
const {
  formatDurationLabel,
  todayTimeCard,
} = require("../utils/attendanceFormat");

const COUNTED_STATUSES = ["Completed", "Exceeded", "Approved", "Pending"];

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

/** 275 → "4h 35m", 27 → "0h 27m" (same as attendance) */
const minsLabel = (n) =>
  Number.isFinite(Number(n)) && Number(n) >= 0
    ? formatDurationLabel(n)
    : "";

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

const reviewerCard = (user) =>
  user
    ? { _id: user._id, name: user.name || "" }
    : null;

const IDLE_APPROVAL = {
  status: "Idle",
  by: null,
  at: "",
  atLabel: "",
  note: "",
  requestedAt: "",
  waitMinutes: null,
};

/** Approval log — always an object; Idle when no approval trail. */
const approvalInfo = ({
  status,
  reviewedBy,
  reviewedAt,
  reviewNote,
  requestedAt,
} = {}) => {
  let approvalStatus = status === "Used" ? "Approved" : status || null;
  if (!approvalStatus && !reviewedBy && !reviewedAt) {
    return { ...IDLE_APPROVAL };
  }
  if (!approvalStatus) approvalStatus = "Approved";
  const waitMinutes =
    requestedAt && reviewedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(reviewedAt).getTime() - new Date(requestedAt).getTime()) /
              60000
          )
        )
      : null;
  return {
    status: approvalStatus,
    by: reviewerCard(reviewedBy),
    at: reviewedAt ? clock12(reviewedAt) : "",
    atLabel: reviewedAt
      ? `${dateLabel(
          new Date(reviewedAt).toLocaleDateString("en-CA", {
            timeZone: TZ(),
          })
        )} ${clock12(reviewedAt)}`.trim()
      : "",
    note: String(reviewNote || "").trim(),
    requestedAt: requestedAt ? clock12(requestedAt) : "",
    waitMinutes,
  };
};

/**
 * Ended break display status.
 * If used > allowed → Exceeded (even if DB still says Completed).
 * Legacy Approved/Rejected → Completed (approval lives in approvalStatus).
 */
const breakDisplayStatus = (raw, minutes, allowedMinutes) => {
  if (
    allowedMinutes != null &&
    Number.isFinite(Number(minutes)) &&
    Number(minutes) > Number(allowedMinutes)
  ) {
    return "Exceeded";
  }
  if (raw === "Exceeded") return "Exceeded";
  if (raw === "Approved" || raw === "Rejected" || raw === "Pending") {
    return "Completed";
  }
  return raw || "Completed";
};

const overMinutesOf = (minutes, allowedMinutes) => {
  if (allowedMinutes == null) return undefined;
  const over = Number(minutes) - Number(allowedMinutes);
  return over > 0 ? over : undefined;
};

/** Day Break grant row status for history (never empty). */
const grantDisplayStatus = (grantStatus) => {
  if (grantStatus === "Pending") return "Pending";
  if (grantStatus === "Approved") return "Idle"; // approved, not started yet
  if (grantStatus === "Used") return "Completed";
  if (grantStatus === "Rejected") return "Rejected";
  return grantStatus || "Idle";
};

/** Stored / derived approvalStatus on a BreakSession (legacy-safe). */
const sessionApprovalStatus = (session) => {
  if (session?.approvalStatus) return session.approvalStatus;
  if (session?.status === "Approved") return "Approved";
  if (session?.status === "Rejected") return "Rejected";
  if (session?.status === "Pending") return "Pending";
  if (session?.reviewedBy || session?.dayGrantId) return "Approved";
  return "Idle";
};

/** approvalStatus for Day Break grant rows in APIs. */
const grantApprovalStatus = (grantStatus) => {
  if (grantStatus === "Used") return "Approved";
  if (grantStatus === "Pending" || grantStatus === "Approved" || grantStatus === "Rejected") {
    return grantStatus;
  }
  return "Idle";
};

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
  if (s === "exceeded") return "exceeded";
  return "all";
};

const historyKey = (raw) => {
  const s = String(raw || "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "completed") return "Completed";
  if (s === "exceeded") return "Exceeded";
  if (s === "pending") return "Pending";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "idle") return "Idle";
  return "all";
};

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

/** Approve / Reject Day Break request — HR or that person's reporting manager. */
const canReviewBreak = (actor, employee, status) => {
  if (status !== "Pending" || !actor || !employee) return false;
  if (normalizeRoleName(actor.role) === EMPLOYEE) return false;
  if (String(actor._id) === String(employee._id)) return false;
  return !assertTeamOrCompanyEmployee(actor, employee);
};

/**
 * End status from used vs allowed (no RM overage approve).
 * Within / equal allowed → Completed. Past allowed → Exceeded.
 */
const closeStatus = (duration, allowed) => {
  if (allowed == null) return "Completed";
  if (Number(duration) > Number(allowed)) return "Exceeded";
  return "Completed";
};

/**
 * Minutes of one fixed policy already used today.
 * Uses live policy minutes for remaining: remaining = policy.minutes - used.
 * Counts Completed / Approved / Pending + open On Break / Overdue (elapsed so far).
 */
const usedOfType = async (employeeId, date, breakType) => {
  const rows = await BreakSession.find({
    employee: employeeId,
    date,
    breakType,
    status: { $in: [...COUNTED_STATUSES, "On Break", "Overdue"] },
  })
    .select("durationMinutes startedAt endedAt")
    .lean();
  return rows.reduce((sum, row) => {
    if (row.endedAt) return sum + (Number(row.durationMinutes) || 0);
    return sum + elapsedMinutes(row.startedAt);
  }, 0);
};

/** Approved Day Break grant not yet used today (if any). */
const openDayGrant = (employeeId, date) =>
  BreakDayGrant.findOne({
    employee: employeeId,
    date,
    status: "Approved",
  }).sort({ createdAt: 1 });

/** Pending Day Break request today (waiting for RM / HR). */
const pendingDayGrant = (employeeId, date) =>
  BreakDayGrant.findOne({
    employee: employeeId,
    date,
    status: "Pending",
  }).sort({ createdAt: -1 });

/**
 * Next break to start automatically:
 * 1) Fixed policies with remaining minutes (Lunch → Tea, …)
 * 2) Else flexible Day Break only if an Approved grant exists
 */
const resolveNextBreak = async (employeeId, date) => {
  const list = await policiesForEmployee(employeeId, date);
  const fixed = list.filter((row) => !row.flexible && (row.remainingMinutes || 0) > 0);
  if (fixed.length) {
    const pick = fixed[0];
    const policy = await findPublishedByName(pick.name);
    return {
      policy,
      allowedMinutes: pick.remainingMinutes,
      kind: "fixed",
      grant: null,
    };
  }

  const flexible = list.find((row) => row.flexible);
  if (!flexible) {
    return { policy: null, allowedMinutes: null, kind: "none", grant: null };
  }

  const grant = await openDayGrant(employeeId, date);
  if (!grant) {
    const pending = await pendingDayGrant(employeeId, date);
    return {
      policy: await findPublishedByName(flexible.name),
      allowedMinutes: null,
      kind: "day_needs_approval",
      grant: null,
      pendingGrant: pending,
    };
  }

  return {
    policy: await findPublishedByName(flexible.name),
    allowedMinutes: grant.minutes,
    kind: "day_granted",
    grant,
  };
};

/** Employee sees published policies only. No count of how many times they went. */
const policiesForEmployee = async (employeeId, date) => {
  const rows = await publishedPolicies();
  const list = [];
  for (const row of rows) {
    if (row.flexible) {
      const grant = await openDayGrant(employeeId, date);
      const pending = await pendingDayGrant(employeeId, date);
      const card = { name: row.name, flexible: true };
      if (grant) {
        card.canStart = true;
        card.approvedMinutes = grant.minutes;
      } else {
        card.needsApproval = true;
        if (pending) card.pendingMinutes = pending.minutes;
      }
      list.push(card);
      continue;
    }
    // Live policy minutes (e.g. 30 → 45)
    const used = await usedOfType(employeeId, date, row.name);
    const minutes = Math.max(0, Number(row.minutes) || 0);
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

/** What the employee sees. Never null — Idle object when no session. */
const employeeBreak = (session) => {
  if (!session) {
    return {
      breakType: "",
      startedAt: "",
      endedAt: "",
      minutes: 0,
      status: "Idle",
      approvalStatus: "Idle",
      allowedMinutes: null,
    };
  }
  const open = !session.endedAt;
  const minutes = open
    ? elapsedMinutes(session.startedAt)
    : session.durationMinutes || 0;
  const card = {
    breakType: session.breakType,
    startedAt: clock12(session.startedAt),
    endedAt: open ? "" : clock12(session.endedAt),
    minutes,
    status: open
      ? session.status
      : breakDisplayStatus(
          session.status,
          minutes,
          session.allowedMinutes
        ),
    approvalStatus: sessionApprovalStatus(session),
    allowedMinutes: session.allowedMinutes,
  };
  const over = overMinutesOf(minutes, session.allowedMinutes);
  if (over != null) card.overMinutes = over;
  return card;
};

const employeePayload = async (user, attendance, session, message) => {
  const date = attendance?.date || session?.date || todayDate();
  const punchedIn = Boolean(attendance?.punchIn);
  const punchedOut = Boolean(attendance?.punchOut);
  const onBreak = Boolean(session && !session.endedAt);
  const { shift } = await getAssignedShift(user._id, date);
  const body = {
    date,
    canStart: punchedIn && !punchedOut && !onBreak,
    canEnd: onBreak,
    policies: await policiesForEmployee(user._id, date),
    break: employeeBreak(session),
    todayTime: todayTimeCard(attendance, shift, { onBreak, slim: true }),
  };

  // Only when free to start — avoid repeating current open break as "next"
  if (body.canStart) {
    const next = await resolveNextBreak(user._id, date);
    if (next.kind === "fixed") {
      body.nextBreak = {
        name: next.policy.name,
        remainingMinutes: next.allowedMinutes,
      };
    } else if (next.kind === "day_granted") {
      body.nextBreak = {
        name: next.policy.name,
        remainingMinutes: next.allowedMinutes,
      };
    } else if (next.kind === "day_needs_approval") {
      body.nextBreak = {
        name: next.policy?.name || "Day Break",
        needsApproval: true,
      };
    }
  }

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
    approvalStatus: sessionApprovalStatus(session),
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
/** Day buckets of breaks — each item is one date object, newest date first. */
const breakHistoryFor = async (employeeId, { limit = 14 } = {}) => {
  const rows = await BreakSession.find({ employee: employeeId })
    .select(
      "breakType status approvalStatus date startedAt endedAt durationMinutes allowedMinutes reviewedBy dayGrantId"
    )
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
        minutes: 0,
        breaks: [],
      };
      byDate.set(row.date, day);
    }
    day.minutes += minutes;
    const item = {
      breakType: row.breakType || "Break",
      startedAt: clock12(row.startedAt),
      endedAt: row.endedAt ? clock12(row.endedAt) : "",
      minutes,
      allowedMinutes: row.allowedMinutes,
      status: row.endedAt
        ? breakDisplayStatus(row.status, minutes, row.allowedMinutes)
        : row.status || "On Break",
      approvalStatus: sessionApprovalStatus(row),
    };
    const over = overMinutesOf(minutes, row.allowedMinutes);
    if (over != null) item.overMinutes = over;
    day.breaks.push(item);
  }

  // Explicit newest-first (YYYY-MM-DD string sort is chronological)
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
};

const myBreak = async (req, res) => {
  try {
    const date = todayDate();
    const employeeId = req.user._id;
    const attendance = await Attendance.findOne({ employee: employeeId, date }).select(
      "punchIn punchOut companyId date breaks workedMinutes"
    );
    const open = await storeOpenStatus(
      await BreakSession.findOne({ employee: employeeId, date, endedAt: null })
    );
    const body = await employeePayload(req.user, attendance, open);
    // Today + past — one list of day objects, latest date on top
    body.history = await breakHistoryFor(employeeId, { limit: 14 });
    return res.json(body);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/start
 * Body: { latitude, longitude } — must be within 50m of branch (address → lat/long).
 * Type auto-picked (breakType in body ignored).
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

    const open = await BreakSession.findOne({ employee: employeeId, endedAt: null }).select("_id");
    if (open) {
      return res.status(400).json({ message: "You are already on a break" });
    }

    // Same 50m geofence as punch-in / punch-out
    if (!isApprovedTourDuty(attendance)) {
      const { company, branch } = await getAssignedShift(employeeId, date);
      const location = await resolvePunchLocation(req.body);
      const office = await resolveOfficeLocation(branch, { companyId: company?._id });
      const geo = assertWithinPunchRadius(location, office);
      if (!geo.ok) {
        return res.status(400).json({
          message: geo.message,
          distanceMeters: geo.distanceMeters ?? null,
          distanceKm: geo.distanceKm ?? null,
          allowedRadiusMeters: PUNCH_RADIUS_METERS,
        });
      }
    }

    const user = await User.findById(employeeId).select(
      "name role profileUrl official.employeeCode official.officialEmail official.department official.designation official.shiftId official.companyIds"
    );

    // Auto only — ignore body.breakType / minutes
    const next = await resolveNextBreak(employeeId, date);
    if (next.kind === "none" || !next.policy) {
      return res.status(400).json({ message: "No break policy available" });
    }
    if (next.kind === "day_needs_approval") {
      return res.status(400).json({
        message: next.pendingGrant
          ? "Day Break request is waiting for reporting manager / HR approval"
          : "Fixed break time is used. Request Day Break approval first (POST /api/break/day-request)",
        nextBreak: next.policy.name,
        needsApproval: true,
        pendingRequest: Boolean(next.pendingGrant),
      });
    }

    const policy = next.policy;
    const allowedMinutes = next.allowedMinutes;

    const shiftId = user?.official?.shiftId || null;
    let shiftName = "";
    if (shiftId) {
      const shift = await getModel("shift").findById(shiftId).select("name").lean();
      shiftName = shift?.name || "";
    }

    const companyId = companyIdOf(user, attendance);
    const now = new Date();
    const grant = next.grant || null;
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
      approvalStatus: grant ? "Approved" : "Idle",
      // Snapshot approval onto the break row for history logs
      dayGrantId: grant?._id || null,
      approvalRequestedAt: grant?.createdAt || null,
      reviewedBy: grant?.reviewedBy || null,
      reviewedAt: grant?.reviewedAt || null,
      reviewNote: grant?.reviewNote || "",
    });

    try {
      await session.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ message: "You are already on a break" });
      }
      throw err;
    }

    if (grant) {
      grant.status = "Used";
      grant.usedBreakId = session._id;
      await grant.save();
    }

    await pushAttendanceBreak(employeeId, date, now);
    await logBreakActivity(req.user, user, session);

    return res.status(201).json(
      await employeePayload(user, attendance, session, `Break started (${policy.name})`)
    );
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/day-request
 * Body: { minutes } — employee asks for Day Break; RM / HR must approve first.
 */
const requestDayBreak = async (req, res) => {
  try {
    const date = todayDate();
    const employeeId = req.user._id;
    const minutes = Number(req.body.minutes);
    if (!Number.isInteger(minutes) || minutes < 1) {
      return res.status(400).json({ message: "Enter minutes, for example 5 or 10" });
    }

    const attendance = await Attendance.findOne({ employee: employeeId, date });
    if (!attendance?.punchIn) {
      return res.status(400).json({ message: "Punch in before requesting Day Break" });
    }

    const next = await resolveNextBreak(employeeId, date);
    if (next.kind === "fixed") {
      return res.status(400).json({
        message: `Use ${next.policy.name} first (${next.allowedMinutes}m left). Day Break is only after fixed breaks are used`,
        nextBreak: next.policy.name,
        remainingMinutes: next.allowedMinutes,
      });
    }
    if (next.kind === "day_granted") {
      return res.status(400).json({
        message: "Day Break is already approved. Call POST /api/break/start",
        approvedMinutes: next.allowedMinutes,
      });
    }

    const existing = await pendingDayGrant(employeeId, date);
    if (existing) {
      return res.status(400).json({
        message: "Day Break request already pending",
        request: {
          _id: existing._id,
          minutes: existing.minutes,
          status: existing.status,
        },
      });
    }

    const user = await User.findById(employeeId).select(
      "name official.companyIds official.department"
    );
    const grant = await BreakDayGrant.create({
      employee: employeeId,
      companyId: companyIdOf(user, attendance),
      date,
      minutes,
      status: "Pending",
    });

    return res.status(201).json({
      message: "Day Break requested. Waiting for reporting manager / HR approval",
      request: {
        _id: grant._id,
        date: grant.date,
        minutes: grant.minutes,
        status: "Pending",
        approvalStatus: "Pending",
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/day-request/:id/review
 * Body: { decision: approve|reject, remarks? }
 */
const reviewDayRequest = async (req, res) => {
  try {
    const grant = await BreakDayGrant.findById(req.params.id);
    if (!grant) return res.status(404).json({ message: "Day Break request not found" });
    if (grant.status !== "Pending") {
      return res.status(400).json({ message: "Only a pending Day Break request can be reviewed" });
    }

    const employee = await User.findById(grant.employee).select(
      "name role official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2"
    );
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    if (String(req.user._id) === String(grant.employee)) {
      return res.status(403).json({ message: "You cannot review your own Day Break request" });
    }
    const denied = assertTeamOrCompanyEmployee(req.user, employee);
    if (denied) return res.status(403).json({ message: denied });

    const approve = String(req.body.decision).toLowerCase() === "approve";
    grant.status = approve ? "Approved" : "Rejected";
    grant.reviewNote = String(req.body.remarks || "").trim();
    grant.reviewedBy = req.user._id;
    grant.reviewedAt = new Date();
    await grant.save();

    return res.json({
      message: approve
        ? "Day Break approved. Employee can POST /api/break/start"
        : "Day Break request rejected",
      request: {
        _id: grant._id,
        date: grant.date,
        minutes: grant.minutes,
        status: grantDisplayStatus(grant.status),
        approvalStatus: grantApprovalStatus(grant.status),
        reviewNote: grant.reviewNote,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/break/end
 * Body: { latitude, longitude } — must be within 50m of branch. Closes open break.
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

    const attendance = await Attendance.findOne({
      employee: req.user._id,
      date: session.date,
    });
    // Same 50m geofence as punch-in / punch-out
    if (!isApprovedTourDuty(attendance)) {
      const { company, branch } = await getAssignedShift(req.user._id, session.date);
      const location = await resolvePunchLocation(req.body);
      const office = await resolveOfficeLocation(branch, { companyId: company?._id });
      const geo = assertWithinPunchRadius(location, office);
      if (!geo.ok) {
        return res.status(400).json({
          message: geo.message,
          distanceMeters: geo.distanceMeters ?? null,
          distanceKm: geo.distanceKm ?? null,
          allowedRadiusMeters: PUNCH_RADIUS_METERS,
        });
      }
    }

    await finishSession(session, "employee", req.user._id);
    const employee = await User.findById(req.user._id).select(
      "name role official.employeeCode official.officialEmail official.department official.designation official.companyIds"
    );
    await logBreakActivity(req.user, employee, session);
    const full = attendance;
    const { shift } = await getAssignedShift(req.user._id, session.date);
    const progress = workProgress(full, shift);
    if (full && !full.punchOut) {
      full.workedMinutes = progress.workedMinutes;
      await full.save();
    }
    const over =
      session.allowedMinutes != null &&
      session.durationMinutes > session.allowedMinutes;
    const body = await employeePayload(
      req.user,
      full,
      session,
      over
        ? `Break ended — used ${session.durationMinutes - session.allowedMinutes}m more than allowed`
        : "Break ended"
    );
    body.break.minutes = session.durationMinutes;
    body.break.status = session.status;
    if (over) {
      body.break.overMinutes = session.durationMinutes - session.allowedMinutes;
    }
    body.attendance = {
      breakMinutes: session.durationMinutes,
      breakMinutesToday: progress.breakMinutes,
      worked: formatDurationLabel(progress.workedMinutes),
      required: formatDurationLabel(progress.requiredMinutes),
      remaining: formatDurationLabel(progress.remainingMinutes),
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
      .select(
        "name profileUrl role official.employeeCode official.department official.shiftId official.companyIds official.reportingHead1 official.reportingHead2"
      )
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
    const openByEmployee = new Map(
      openBreaks.map((row) => [String(row.employee), row])
    );
    const todayRows = await BreakSession.find({ date, employee: { $in: ids } })
      .select(
        "employee breakType status approvalStatus startedAt endedAt durationMinutes allowedMinutes reviewedBy dayGrantId"
      )
      .sort({ startedAt: 1 })
      .lean();
    const todayByEmployee = new Map();
    for (const row of todayRows) {
      const key = String(row.employee);
      const prev = todayByEmployee.get(key) || { minutes: 0, breaks: [] };
      const minutes = row.endedAt
        ? row.durationMinutes || 0
        : elapsedMinutes(row.startedAt);
      const ended = Boolean(row.endedAt);
      const st = ended
        ? breakDisplayStatus(row.status, minutes, row.allowedMinutes)
        : row.status || "On Break";
      const item = {
        breakType: row.breakType || "Break",
        startedAt: clock12(row.startedAt),
        endedAt: ended ? clock12(row.endedAt) : "",
        minutes,
        allowedMinutes: row.allowedMinutes,
        status: st,
        approvalStatus: sessionApprovalStatus(row),
      };
      const over = overMinutesOf(minutes, row.allowedMinutes);
      if (over != null) item.overMinutes = over;
      prev.minutes += minutes;
      prev.breaks.push(item);
      todayByEmployee.set(key, prev);
    }

    const rows = [];
    for (const user of employees) {
      const id = String(user._id);
      if (!inOffice.has(id)) continue;
      const session = openByEmployee.get(id) || null;
      const today = todayByEmployee.get(id) || { minutes: 0, breaks: [] };
      const row = {
        employee: employeeCard(user),
        department: user.official?.department || "",
        shift:
          names.get(String(user.official?.shiftId || "")) ||
          session?.shiftName ||
          "",
        status: session ? session.status : "At Desk",
        today: {
          minutes: today.minutes,
          breaks: today.breaks,
        },
      };
      if (session) {
        row.break = {
          _id: session._id,
          breakType: session.breakType,
          startedAt: clock12(session.startedAt),
          minutes: elapsedMinutes(session.startedAt),
          allowedMinutes: session.allowedMinutes,
          status: session.status,
          approvalStatus: sessionApprovalStatus(session),
        };
      }
      rows.push(row);
    }

    const counts = {
      all: rows.length,
      onBreak: rows.filter((row) => row.status === "On Break").length,
      atDesk: rows.filter((row) => row.status === "At Desk").length,
      overdue: rows.filter((row) => row.status === "Overdue").length,
      /** People who ended at least one break past allowed today */
      exceeded: rows.filter((row) =>
        (row.today?.breaks || []).some((b) => b.status === "Exceeded")
      ).length,
    };

    const key = liveKey(req.query.status);
    const filtered =
      key === "all"
        ? rows
        : key === "exceeded"
          ? rows.filter((row) =>
              (row.today?.breaks || []).some((b) => b.status === "Exceeded")
            )
          : rows.filter((row) => liveKey(row.status) === key);

    const rank = { Overdue: 0, "On Break": 1, "At Desk": 2 };
    filtered.sort(
      (a, b) =>
        (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
        a.employee.name.localeCompare(b.employee.name)
    );

    return res.json({
      date,
      statuses: ["all", "on_break", "at_desk", "overdue", "exceeded"],
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
 * Taken breaks + Day Break requests — newest first.
 * status filter: all | completed | exceeded | pending | idle | approved | rejected
 */
const breakHistory = async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const people = await User.find(buildEmployeeFilter(req.user, req.query))
      .select(
        "_id name profileUrl role official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2"
      )
      .lean();
    const ids = people.map((row) => row._id);
    const byId = new Map(people.map((row) => [String(row._id), row]));

    const status = historyKey(req.query.status);
    const breakType = String(req.query.breakType || "").trim();
    const typeFilter =
      breakType && breakType.toUpperCase() !== "ALL" ? breakType : "";

    const dateFilter = {};
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (from || to) {
      dateFilter.date = {};
      if (from) dateFilter.date.$gte = from;
      if (to) dateFilter.date.$lte = to;
    }

    const baseSessionQuery = {
      endedAt: { $ne: null },
      employee: { $in: ids },
      status: { $nin: ["Pending"] },
      ...dateFilter,
    };
    if (typeFilter) {
      baseSessionQuery.breakType = new RegExp(
        `^${escapeRegex(typeFilter)}$`,
        "i"
      );
    }

    const baseGrantQuery = {
      employee: { $in: ids },
      status: { $in: ["Pending", "Approved", "Rejected"] },
      ...dateFilter,
    };
    if (typeFilter && !/^day\s*break$/i.test(typeFilter)) {
      baseGrantQuery._id = { $in: [] };
    }

    // Load full scope for filter counts, then slice by status
    const [allSessions, allGrants] = await Promise.all([
      BreakSession.find(baseSessionQuery).sort({ startedAt: -1 }).lean(),
      BreakDayGrant.find(baseGrantQuery).sort({ createdAt: -1 }).lean(),
    ]);

    const reviewerIds = [
      ...new Set(
        [...allSessions, ...allGrants]
          .map((row) => String(row.reviewedBy || ""))
          .filter(Boolean)
      ),
    ];
    const reviewers = reviewerIds.length
      ? await User.find({ _id: { $in: reviewerIds } }).select("name").lean()
      : [];
    const reviewerById = new Map(
      reviewers.map((row) => [String(row._id), row])
    );

    const mapSession = (session) => {
      const user = byId.get(String(session.employee));
      const approvalStatus = sessionApprovalStatus(session);
      const minutes = session.durationMinutes || 0;
      const display = breakDisplayStatus(
        session.status,
        minutes,
        session.allowedMinutes
      );
      const row = {
        type: "break",
        _id: session._id,
        employee: employeeCard(user),
        department: session.department || user?.official?.department || "",
        shift: session.shiftName || "",
        date: session.date,
        dateLabel: dateLabel(session.date),
        breakType: session.breakType,
        startedAt: clock12(session.startedAt),
        endedAt: clock12(session.endedAt),
        minutes,
        allowedMinutes: session.allowedMinutes,
        status: display,
        approvalStatus,
        approval: approvalInfo({
          status: approvalStatus === "Idle" ? null : approvalStatus,
          reviewedBy: reviewerById.get(String(session.reviewedBy || "")),
          reviewedAt: session.reviewedAt,
          reviewNote: session.reviewNote,
          requestedAt: session.approvalRequestedAt || session.endedAt || null,
        }),
        canReview: false,
        _at: new Date(session.startedAt || session.endedAt || 0).getTime(),
      };
      const over = overMinutesOf(minutes, session.allowedMinutes);
      if (over != null) row.overMinutes = over;
      return row;
    };

    const mapGrant = (grant) => {
      const user = byId.get(String(grant.employee));
      const approvalStatus = grantApprovalStatus(grant.status);
      return {
        type: "day_break",
        _id: grant._id,
        employee: employeeCard(user),
        department: user?.official?.department || "",
        shift: "",
        date: grant.date,
        dateLabel: dateLabel(grant.date),
        breakType: "Day Break",
        startedAt: "",
        endedAt: "",
        minutes: grant.minutes,
        allowedMinutes: grant.minutes,
        status: grantDisplayStatus(grant.status),
        approvalStatus,
        approval: approvalInfo({
          status: grant.status,
          reviewedBy: reviewerById.get(String(grant.reviewedBy || "")),
          reviewedAt: grant.reviewedAt,
          reviewNote: grant.reviewNote,
          requestedAt: grant.createdAt,
        }),
        canReview: canReviewBreak(req.user, user, grant.status),
        _at: new Date(grant.createdAt || grant.date || 0).getTime(),
      };
    };

    const allRows = [
      ...allSessions.map(mapSession),
      ...allGrants.map(mapGrant),
    ].sort((a, b) => b._at - a._at);

    const counts = {
      all: allRows.length,
      completed: allRows.filter((r) => r.status === "Completed").length,
      exceeded: allRows.filter((r) => r.status === "Exceeded").length,
      pending: allRows.filter((r) => r.status === "Pending").length,
      idle: allRows.filter((r) => r.status === "Idle").length,
      approved: allRows.filter((r) => r.approvalStatus === "Approved").length,
      rejected: allRows.filter(
        (r) => r.status === "Rejected" || r.approvalStatus === "Rejected"
      ).length,
    };

    const filtered =
      status === "all"
        ? allRows
        : status === "Approved"
          ? allRows.filter((r) => r.approvalStatus === "Approved")
          : status === "Rejected"
            ? allRows.filter(
                (r) =>
                  r.status === "Rejected" || r.approvalStatus === "Rejected"
              )
            : allRows.filter((r) => r.status === status);

    const total = filtered.length;
    const data = filtered
      .slice(skip, skip + limit)
      .map(({ _at, ...row }) => row);

    return res.json({
      statuses: [
        "all",
        "completed",
        "exceeded",
        "pending",
        "idle",
        "approved",
        "rejected",
      ],
      counts,
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
 * Day Break requests only (Pending).
 * Review: POST /api/break/day-request/:id/review
 */
const pendingBreaks = async (req, res) => {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const filter = buildEmployeeFilter(req.user, req.query);
    const employees = await User.find(filter)
      .select(
        "_id name profileUrl role official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2"
      )
      .lean();
    const ids = employees.map((row) => row._id);
    const byId = new Map(employees.map((row) => [String(row._id), row]));

    const dateFilter = {};
    if (req.query.from || req.query.to) {
      dateFilter.date = {};
      if (req.query.from) dateFilter.date.$gte = String(req.query.from).slice(0, 10);
      if (req.query.to) dateFilter.date.$lte = String(req.query.to).slice(0, 10);
    }

    const grants = await BreakDayGrant.find({
      employee: { $in: ids },
      status: "Pending",
      ...dateFilter,
    })
      .sort({ createdAt: -1 })
      .lean();

    const rows = grants.map((grant) => {
      const user = byId.get(String(grant.employee));
      return {
        type: "day_break",
        _id: grant._id,
        employee: employeeCard(user),
        department: user?.official?.department || "",
        date: grant.date,
        dateLabel: dateLabel(grant.date),
        breakType: "Day Break",
        minutes: grant.minutes,
        status: "Pending",
        approvalStatus: "Pending",
        approval: approvalInfo({
          status: "Pending",
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: "",
          requestedAt: grant.createdAt,
        }),
        canReview: canReviewBreak(req.user, user, "Pending"),
      };
    });

    const total = rows.length;
    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows.slice(skip, skip + limit),
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
    if (req.body.published != null) {
      row.published = Boolean(req.body.published);
    }
    if (!row.flexible && (row.minutes == null || row.minutes < 1)) {
      return res.status(400).json({ message: "minutes is required when the break is not flexible" });
    }
    await row.save();
    return res.json({
      message: row.published
        ? "Policy updated. Employees can use it"
        : "Policy updated. Employees cannot see it",
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
  requestDayBreak,
  reviewDayRequest,
  liveBreaks,
  breakHistory,
  pendingBreaks,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
