/**
 * Yearly leave wallet.
 * Leave year starts 1 April (matches the default Leave Policies row).
 * Comp Off extra days sit in `adjusted` and increase `remaining` for that type name.
 */
const LeaveType = require("../models/LeaveType");
const LeaveBalance = require("../models/LeaveBalance");
const User = require("../models/User");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");

const round = (n) => Math.round((Number(n) || 0) * 2) / 2;

const todayYmd = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** April–March. 2026-04-01 → 2026, 2026-03-31 → 2025. */
const leaveYear = (ymd = todayYmd()) => {
  const [y, m] = String(ymd).split("-").map(Number);
  return m >= 4 ? y : y - 1;
};

const yearLabel = (year) => `${year}-${String(year + 1).slice(-2)}`;

const companyOf = (user) => {
  const raw = user?.official?.companyIds || [];
  const id = raw[0];
  return id?._id || id || null;
};

const lineFromType = (type, year) => {
  const line = {
    leaveType: type._id,
    year,
    adjusted: 0,
    used: 0,
    pending: 0,
    available: 0,
    remaining: 0,
  };
  return stampLine(line, type.maxDays);
};

/** available = max days + extra. remaining = available − used − pending. */
const stampLine = (line, maxDays) => {
  line.available = round((Number(maxDays) || 0) + (line.adjusted || 0));
  line.remaining = round(line.available - (line.used || 0) - (line.pending || 0));
  return line;
};

const leaveLine = (user, leaveTypeId, year) =>
  (user?.leaves || []).find(
    (row) => row.year === year && String(row.leaveType) === String(leaveTypeId)
  );

/** Name and max days come from the type. Counters live on the employee. */
const presentItem = (item, type) => {
  if (!item || !type) return null;
  const available = round(type.maxDays + item.adjusted);
  const remaining = round(available - item.used - item.pending);
  return {
    leaveType: type._id,
    scope: type.scope,
    name: type.name,
    code: type.code,
    paid: type.paid,
    carryForward: type.carryForward,
    total: available,
    available,
    adjusted: item.adjusted,
    used: item.used,
    pending: item.pending,
    remaining,
    display: `${remaining}/${available}`,
  };
};

const findItem = (balance, leaveTypeId) =>
  (balance?.items || []).find((i) => String(i.leaveType) === String(leaveTypeId));

/** Common types, plus this company's own. Same code → company row wins. Hidden company row removes that code. */
const typesForCompany = (rows, companyId) => {
  const hidden = new Set(
    rows
      .filter(
        (row) =>
          row.hidden &&
          row.scope !== "common" &&
          String(row.companyId) === String(companyId)
      )
      .map((row) => row.code)
  );
  const byCode = new Map();
  for (const row of rows) {
    if (row.hidden || hidden.has(row.code)) continue;
    const common = row.scope === "common";
    const mine = !common && String(row.companyId) === String(companyId);
    if (!common && !mine) continue;
    if (!common) byCode.set(row.code, row);
    else if (!byCode.has(row.code)) byCode.set(row.code, row);
  }
  return [...byCode.values()];
};

const activeTypeQuery = (companyIds) => ({
  status: "Active",
  hidden: { $ne: true },
  $or: [
    { scope: "common" },
    { scope: "company", companyId: { $in: companyIds } },
  ],
});

/** Active catalog plus company hide-markers, so a hidden code is not granted again. */
const catalogRows = async (companyIds) => {
  const [active, hidden] = await Promise.all([
    LeaveType.find(activeTypeQuery(companyIds)).lean(),
    LeaveType.find({
      scope: "company",
      companyId: { $in: companyIds },
      hidden: true,
    })
      .select("code companyId scope hidden")
      .lean(),
  ]);
  return [...active, ...hidden];
};

/** Put this year's lines on the employee. Copies an old wallet once. Safe to call twice. */
const grantLeaveBalance = async (user) => {
  if (!user || normalizeRoleName(user.role) !== EMPLOYEE) return null;
  const companyId = companyOf(user);
  if (!companyId) return null;
  const year = leaveYear();
  const doc = await User.findById(user._id).select("leaves leaveAdjustments role official.companyIds");
  if (!doc) return null;
  if (!doc.leaves) doc.leaves = [];
  if (!doc.leaveAdjustments) doc.leaveAdjustments = [];
  if (doc.leaves.some((row) => row.year === year)) return doc;

  const rows = await catalogRows([companyId]);
  const types = typesForCompany(rows, companyId);
  const typeById = new Map(types.map((type) => [String(type._id), type]));
  const old = await LeaveBalance.findOne({ employee: doc._id, year }).lean();
  const lines = [];
  if (old?.items?.length) {
    for (const item of old.items) {
      let type = typeById.get(String(item.leaveType));
      if (!type) type = await LeaveType.findById(item.leaveType).select("maxDays").lean();
      if (!type) continue;
      lines.push(
        stampLine(
          {
            leaveType: item.leaveType,
            year,
            adjusted: item.adjusted || 0,
            used: item.used || 0,
            pending: item.pending || 0,
          },
          type.maxDays
        )
      );
    }
    for (const type of types) {
      if (!lines.some((row) => String(row.leaveType) === String(type._id))) {
        lines.push(lineFromType(type, year));
      }
    }
    for (const row of old.adjustments || []) {
      doc.leaveAdjustments.push({
        leaveType: row.leaveType,
        year,
        days: row.days,
        reason: row.reason || "",
        by: row.by,
        at: row.at || new Date(),
      });
    }
  } else {
    for (const type of types) lines.push(lineFromType(type, year));
  }
  doc.leaves.push(...lines);
  await doc.save();
  return doc;
};

/** Apply, approve, reject, or cancel. Writes available and remaining on the employee. */
const moveLeave = async (employeeId, type, days, direction) => {
  const year = leaveYear();
  const user = await User.findById(employeeId).select("leaves");
  const line = leaveLine(user, type._id, year);
  if (!user || !line) return { error: "Leave balance not found for this type" };
  const remaining = round(type.maxDays + line.adjusted - line.used - line.pending);
  if (direction === "hold") {
    if (remaining < days) return { error: `Only ${remaining} ${type.name} remaining` };
    line.pending = round(line.pending + days);
  } else if (direction === "approve") {
    line.pending = round(Math.max(0, line.pending - days));
    line.used = round(line.used + days);
  } else {
    line.pending = round(Math.max(0, line.pending - days));
  }
  stampLine(line, type.maxDays);
  user.markModified("leaves");
  await user.save();
  return { item: presentItem(line, type) };
};

/**
 * Add this type id to wallets that do not have it yet.
 * common → every company. company → that company only.
 * Same code as a common type: that company's line switches to the company type.
 */
const pushTypeToBalances = async (type) => {
  if (type.status !== "Active" || type.hidden) return;
  const year = leaveYear();
  const filter = { role: EMPLOYEE, status: "Active" };
  if (type.scope === "company") filter["official.companyIds"] = type.companyId;
  if (type.scope === "common") {
    const hidden = await LeaveType.find({ scope: "company", code: type.code, hidden: true })
      .select("companyId")
      .lean();
    if (hidden.length) filter["official.companyIds"] = { $nin: hidden.map((row) => row.companyId) };
  }
  let commonId = null;
  if (type.scope === "company") {
    const common = await LeaveType.findOne({ scope: "common", code: type.code }).select("_id").lean();
    commonId = common?._id || null;
  }
  const users = await User.find(filter).select("leaves");
  for (const user of users) {
    if (commonId) {
      const switched = leaveLine(user, commonId, year);
      if (switched) {
        switched.leaveType = type._id;
        stampLine(switched, type.maxDays);
        user.markModified("leaves");
        await user.save();
        continue;
      }
    }
    if (leaveLine(user, type._id, year)) continue;
    if (!user.leaves) user.leaves = [];
    user.leaves.push(lineFromType(type, year));
    await user.save();
  }
};

/**
 * Employees created before types existed get a wallet here.
 * Missing types are pushed onto wallets that already exist.
 */
const ensureCompanyBalances = async (companyIds) => {
  if (!companyIds?.length) return;
  const year = leaveYear();
  const [types, employees] = await Promise.all([
    catalogRows(companyIds),
    User.find({
      role: EMPLOYEE,
      status: "Active",
      "official.companyIds": { $in: companyIds },
    })
      .select("_id official.companyIds leaves role")
      .lean(),
  ]);
  if (!employees.length) return;

  for (const emp of employees) {
    if ((emp.leaves || []).some((row) => row.year === year)) continue;
    await grantLeaveBalance(emp);
  }

  await Promise.all(types.map((type) => pushTypeToBalances(type)));
};

/** Block a lower max when someone has already used more than that. */
const syncTypeOnBalances = async (type) => {
  const year = leaveYear();
  const users = await User.find({
    leaves: { $elemMatch: { leaveType: type._id, year } },
  }).select("leaves");
  for (const user of users) {
    const line = leaveLine(user, type._id, year);
    if (!line) continue;
    if (round(type.maxDays + line.adjusted - line.used - line.pending) < 0) {
      return {
        ok: false,
        message: `${type.name} is already used more than ${type.maxDays} days`,
      };
    }
  }
  if (type.status === "Active") await pushTypeToBalances(type);
  for (const user of users) {
    const line = leaveLine(user, type._id, year);
    if (!line) continue;
    stampLine(line, type.maxDays);
    user.markModified("leaves");
    await user.save();
  }
  return { ok: true };
};

module.exports = {
  round,
  todayYmd,
  leaveYear,
  yearLabel,
  companyOf,
  presentItem,
  stampLine,
  findItem,
  grantLeaveBalance,
  moveLeave,
  leaveLine,
  typesForCompany,
  pushTypeToBalances,
  ensureCompanyBalances,
  syncTypeOnBalances,
};
