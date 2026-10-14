/**
 * LEAVE
 * Types → yearly wallet on the employee → apply holds remaining →
 * reporting manager / HR / admin approves → used. Comp Off adjust adds days.
 */
const LeaveType = require("../models/LeaveType");
const LeaveRequest = require("../models/LeaveRequest");
const LeavePolicy = require("../models/LeavePolicy");
const User = require("../models/User");
const Company = require("../models/Company");
const {
  round,
  todayYmd,
  leaveYear,
  yearLabel,
  companyOf,
  monthStartForUser,
  monthStartForCompany,
  presentItem,
  summarizeBalances,
  stampLine,
  leaveLine,
  moveLeave,
  slicesFor,
  rebuildQuarterLine,
  quarterlyDateError,
  probationBlock,
  casualDatesError,
  adjustmentView,
  casualAdjustCredit,
  isEarnedType,
  isQuarterlyType,
  poolOf,
  pushTypeToBalances,
  ensureCompanyBalances,
  grantLeaveBalance,
  syncTypeOnBalances,
  typesForCompany,
  eachYmd,
} = require("../utils/leaveBalance");
const {
  hasGlobalCompanyAccess,
  userCompanyIds,
  escapeRegex,
} = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee, getTeamMemberIds } = require("../utils/teamScope");
const { EMPLOYEE, SUPER_ADMIN, HR, REPORTING_MANAGER, normalizeRoleName, isTeamScopedRole } = require("../config/roles");
const { DEFAULT_TYPES } = require("../utils/seedLeave");

const leaveStatus = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all") return "";
  const match = ["Pending", "Approved", "Rejected", "Cancelled"].find((status) => status.toLowerCase() === raw);
  return match || "";
};

const pageOf = (q) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};

const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
};

const monthBounds = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${ym}-01`, end: `${ym}-${pad(last)}`, days: last, pad };
};

/** null ids = every company (Super Admin / Admin with no companyId filter). */
const companyScope = (actor, requested) => {
  const global = hasGlobalCompanyAccess(actor);
  const own = userCompanyIds(actor);
  if (requested) {
    if (!global && !own.includes(String(requested))) {
      return { error: "You can only manage leave for your company" };
    }
    return { ids: [requested] };
  }
  if (global) return { ids: null };
  if (!own.length) return { error: "Your profile has no company" };
  return { ids: own };
};

const pickCompany = (actor, requested) => {
  const scope = companyScope(actor, requested);
  if (scope.error) return scope;
  if (requested) return { companyId: requested };
  if (scope.ids?.length) return { companyId: scope.ids[0] };
  return { error: "Company is required" };
};

const isEmployee = (user) => normalizeRoleName(user.role) === EMPLOYEE;

const mapType = (row) => ({
  _id: row._id,
  scope: row.scope || (row.companyId ? "company" : "common"),
  companyId: row.scope === "common" ? null : row.companyId || null,
  name: row.name,
  code: row.code,
  paid: row.paid,
  maxDays: row.isUnlimited || row.maxDays == null ? null : row.maxDays,
  allocationType: row.allocationType || "yearly",
  quarterlyLimit: row.quarterlyLimit ?? null,
  isUnlimited: !!row.isUnlimited,
  carryForward: row.carryForward,
  status: row.status,
});

const mapCompany = (row) => {
  if (!row) return null;
  return {
    _id: row._id,
    companyName: row.companyName || "",
    companyCode: row.companyCode || "",
    monthStartDay: row.monthStartDay ?? 1,
    monthEndDay: row.monthEndDay ?? 31,
  };
};

const mapRequest = (row, refs) => {
  const emp = refs.users.get(String(row.employee)) || {};
  const type = refs.types.get(String(row.leaveType)) || {};
  const reviewer = row.reviewedBy ? refs.users.get(String(row.reviewedBy)) : null;
  const paid = !!type.paid;
  const split = row.paidDays != null || row.unpaidDays != null;
  const paidDays = split ? round(row.paidDays || 0) : paid ? row.days : 0;
  const unpaidDays = split ? round(row.unpaidDays || 0) : paid ? 0 : row.days;
  const deduction = row.deduction != null ? round(row.deduction) : unpaidDays;
  return {
    _id: row._id,
    employee: {
      _id: row.employee,
      name: emp.name || "",
      employeeCode: emp.official?.employeeCode || "",
      department: emp.official?.department || "",
    },
    company: row.companyId
      ? mapCompany(refs.companies.get(String(row.companyId)) || { _id: row.companyId })
      : null,
    leaveType: type.name || "",
    leaveTypeId: row.leaveType,
    code: type.code || "",
    paid,
    from: row.from,
    to: row.to,
    days: row.days,
    dayType: row.dayType,
    reason: row.reason,
    document: row.document || "",
    paidDays,
    unpaidDays,
    deduction,
    status: row.status,
    applyBy: String(row.appliedBy || row.employee) === String(row.employee) ? "Self" : "Admin",
    reviewedBy: reviewer?.name || "",
    reviewedAt: row.reviewedAt,
    reviewReason: row.reviewReason || "",
    createdAt: row.createdAt,
  };
};

const refsFor = async (rows) => {
  const list = [].concat(rows).filter(Boolean);
  const userIds = new Set();
  const typeIds = new Set();
  const companyIds = new Set();
  for (const row of list) {
    if (row.employee) userIds.add(String(row.employee));
    if (row.reviewedBy) userIds.add(String(row.reviewedBy));
    if (row.leaveType) typeIds.add(String(row.leaveType));
    if (row.companyId) companyIds.add(String(row.companyId));
  }
  const [users, types, companies] = await Promise.all([
    userIds.size
      ? User.find({ _id: { $in: [...userIds] } })
          .select("name official.employeeCode official.department")
          .lean()
      : [],
    typeIds.size
      ? LeaveType.find({ _id: { $in: [...typeIds] } }).select("name code paid").lean()
      : [],
    companyIds.size
      ? Company.find({ _id: { $in: [...companyIds] } })
          .select("companyName companyCode monthStartDay monthEndDay")
          .lean()
      : [],
  ]);
  return {
    users: new Map(users.map((u) => [String(u._id), u])),
    types: new Map(types.map((t) => [String(t._id), t])),
    companies: new Map(companies.map((row) => [String(row._id), row])),
  };
};

const asRequests = async (rows) => {
  const refs = await refsFor(rows);
  return [].concat(rows).map((row) => mapRequest(row, refs));
};

/** Leave requests for one employee, newest first. Used after apply, approve, and cancel. */
const employeeHistory = async (employeeId) => {
  const rows = await LeaveRequest.find({ employee: employeeId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return asRequests(rows);
};

/** Employee dashboard list: search, status, date range, and page. */
const employeeLeavePage = async (employeeId, query = {}) => {
  const filter = { employee: employeeId };
  const status = leaveStatus(query.status);
  const search = String(query.search || "").trim();
  if (query.from) filter.to = { $gte: query.from };
  if (query.to) filter.from = { ...(filter.from || {}), $lte: query.to };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const types = await LeaveType.find({ $or: [{ name: rx }, { code: rx }] }).select("_id").lean();
    filter.$or = [
      { reason: rx },
      { from: rx },
      { to: rx },
      ...(types.length ? [{ leaveType: { $in: types.map((row) => row._id) } }] : []),
    ];
  }
  const { page, limit, skip } = pageOf(query);
  const listFilter = status ? { ...filter, status } : filter;
  const [total, rows, grouped] = await Promise.all([
    LeaveRequest.countDocuments(listFilter),
    LeaveRequest.find(listFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    LeaveRequest.aggregate([{ $match: filter }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  const summary = { all: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const row of grouped) {
    const key = String(row._id || "").toLowerCase();
    if (summary[key] !== undefined) summary[key] = row.n;
    summary.all += row.n;
  }
  return {
    summary,
    history: await asRequests(rows),
    count: rows.length,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  };
};

const loadEmployee = async (id) => {
  const employee = await User.findById(id)
    .select("name role status official.employeeCode official.department official.companyIds official.dateOfJoining official.reportingHead1 official.reportingHead2")
    .lean();
  return employee;
};

const holdDays = (employeeId, type, days, direction, slices, adjustmentDays) =>
  moveLeave(employeeId, type, days, direction, slices, adjustmentDays);

const isUnpaidType = (type) =>
  !!type && (type.paid === false || String(type.code || "").toUpperCase() === "UL");

/** First `days` of the request slices. The rest become unpaid. */
const takeSlices = (slices, days) => {
  let left = round(days);
  const out = [];
  for (const slice of slices || []) {
    if (left <= 0) break;
    const use = round(Math.min(slice.days, left));
    if (use <= 0) continue;
    out.push({ ...slice, days: use });
    left = round(left - use);
  }
  return out;
};

const unpaidTypeFor = async (companyId) => {
  const rows = await LeaveType.find({
    status: "Active",
    hidden: { $ne: true },
    code: "UL",
    $or: [{ scope: "common" }, { scope: "company", companyId }],
  }).lean();
  return typesForCompany(rows, companyId).find((row) => isUnpaidType(row)) || null;
};

/** Hold, approve, or release the paid part and the automatic unpaid part. */
const settleRequestDays = async (request, direction, monthStartDay) => {
  const type = await LeaveType.findById(request.leaveType).lean();
  if (!type) return { error: "Leave type not found" };
  const slices = slicesFor(request.from, request.to, request.dayType, monthStartDay);
  const split = request.paidDays != null || request.unpaidDays != null;
  const paidDays = split ? round(request.paidDays || 0) : request.days;
  const unpaidDays = split ? round(request.unpaidDays || 0) : 0;
  if (paidDays > 0) {
    const moved = await holdDays(
      request.employee,
      type,
      paidDays,
      direction,
      takeSlices(slices, paidDays),
      request.adjustmentDays || 0
    );
    if (moved.error) return moved;
  }
  if (unpaidDays > 0) {
    let unpaidType = request.unpaidLeaveType
      ? await LeaveType.findById(request.unpaidLeaveType).lean()
      : null;
    if (!unpaidType) unpaidType = await unpaidTypeFor(request.companyId);
    if (!unpaidType) return { error: "Unpaid leave type not found" };
    const moved = await holdDays(request.employee, unpaidType, unpaidDays, direction, []);
    if (moved.error) return moved;
  }
  return { ok: true, type };
};

/** Unpaid dates are the days after the paid balance is used. */
const unpaidDatesOf = (from, to, dayType, paidDays, unpaidDays) => {
  if (round(unpaidDays) <= 0) return [];
  if (dayType === "Half Day") return [from];
  return eachYmd(from, to).slice(Math.floor(round(paidDays)));
};

const saveUnpaidOnUser = async (request, year) => {
  const days = round(request.unpaidDays || 0);
  if (days <= 0) return;
  const dates = unpaidDatesOf(request.from, request.to, request.dayType, request.paidDays, days);
  await User.updateOne(
    { _id: request.employee },
    {
      $push: {
        unpaidLeaves: {
          request: request._id,
          leaveType: request.unpaidLeaveType || request.leaveType,
          year,
          from: dates[0] || request.from,
          to: dates[dates.length - 1] || request.to,
          dates,
          days,
          deduction: round(request.deduction != null ? request.deduction : days),
          status: request.status || "Pending",
        },
      },
    }
  );
};

const syncUnpaidOnUser = async (request) => {
  const days = round(request.unpaidDays || 0);
  if (days <= 0) return;
  await User.updateOne(
    { _id: request.employee, "unpaidLeaves.request": request._id },
    { $set: { "unpaidLeaves.$.status": request.status } }
  );
};

const dropUnpaidOnUser = async (request) => {
  if (!request?.employee || !request?._id) return;
  await User.updateOne({ _id: request.employee }, { $pull: { unpaidLeaves: { request: request._id } } });
};

/** Closed-quarter Quarterly Leave is not stored. Release the hold, then delete the row. */
const releaseExpiredQuarterly = async (employeeId) => {
  const today = todayYmd();
  const employeeFilter = employeeId ? { employee: employeeId } : {};
  await LeaveRequest.deleteMany({
    ...employeeFilter,
    status: "Cancelled",
    reviewReason: "Quarter ended. Unused Quarterly Leave expired.",
  });
  const pending = await LeaveRequest.find({
    ...employeeFilter,
    status: "Pending",
    to: { $lt: today },
  });
  for (const request of pending) {
    const monthStartDay = await monthStartForCompany(request.companyId);
    const paidPart = request.paidDays != null || request.unpaidDays != null ? round(request.paidDays || 0) : request.days;
    if (paidPart <= 0) continue;
    if (round(request.adjustmentDays || 0) >= paidPart) continue;
    if (!quarterlyDateError(request.from, request.to, today, monthStartDay)) continue;
    const type = await LeaveType.findById(request.leaveType).lean();
    if (!type || !isQuarterlyType(type)) continue;
    const released = await settleRequestDays(request, "release", monthStartDay);
    if (released.error) continue;
    await dropUnpaidOnUser(request);
    await request.deleteOne();
  }
};

const assertTypeWrite = (actor, type) => {
  if (type.scope === "common") return null;
  const scope = companyScope(actor, type.companyId);
  return scope.error || null;
};

/** No companyId → the shared row for every company. companyId → that company only. */
const writeTarget = (req) => {
  const companyId = req.query.companyId || req.body?.companyId;
  if (!companyId) return { global: true };
  return pickCompany(req.user, companyId);
};

const applyTypeFields = (type, body) => {
  if (body.code) type.code = String(body.code).trim().toUpperCase();
  if (body.name !== undefined) type.name = body.name.trim();
  if (body.paid !== undefined) type.paid = body.paid;
  if (body.allocationType !== undefined) type.allocationType = body.allocationType;
  if (body.quarterlyLimit !== undefined) type.quarterlyLimit = body.quarterlyLimit;
  if (body.isUnlimited !== undefined) type.isUnlimited = body.isUnlimited;
  if (body.isUnlimited) type.maxDays = null;
  else if (body.maxDays !== undefined) type.maxDays = body.maxDays;
  if (body.carryForward !== undefined) type.carryForward = body.carryForward;
  if (body.status !== undefined) type.status = body.status;
};

const listTypes = async (req, res) => {
  try {
    if (req.query.companyId) {
      const picked = pickCompany(req.user, req.query.companyId);
      if (picked.error) return res.status(400).json({ message: picked.error });
      const rows = await LeaveType.find({
        $or: [{ scope: "common" }, { scope: "company", companyId: picked.companyId }],
      }).lean();
      let data = typesForCompany(rows, picked.companyId);
      if (req.query.status) data = data.filter((row) => row.status === req.query.status);
      if (req.query.search) {
        const rx = new RegExp(escapeRegex(req.query.search), "i");
        data = data.filter((row) => rx.test(row.name) || rx.test(row.code));
      }
      data.sort((a, b) => a.name.localeCompare(b.name));
      const { page, limit, skip } = pageOf(req.query);
      const slice = data.slice(skip, skip + limit).map(mapType);
      return res.json({
        count: slice.length,
        total: data.length,
        page,
        pages: Math.ceil(data.length / limit) || 1,
        data: slice,
      });
    }
    const scope = companyScope(req.user, null);
    if (scope.error) return res.status(403).json({ message: scope.error });
    const { page, limit, skip } = pageOf(req.query);
    const and = [];
    if (scope.ids) {
      and.push({
        $or: [
          { scope: "common" },
          { scope: "company", companyId: { $in: scope.ids } },
        ],
      });
    }
    if (!req.query.scope) and.push({ scope: "common" });
    if (req.query.scope === "common") and.push({ scope: "common" });
    if (req.query.scope === "company") {
      and.push({ scope: "company" });
      if (req.query.companyId) and.push({ companyId: req.query.companyId });
      else if (scope.ids) and.push({ companyId: { $in: scope.ids } });
    } else if (req.query.companyId) {
      and.push({
        $or: [{ scope: "common" }, { scope: "company", companyId: req.query.companyId }],
      });
    }
    and.push({ hidden: { $ne: true } });
    if (req.query.status) and.push({ status: req.query.status });
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), "i");
      and.push({ $or: [{ name: rx }, { code: rx }] });
    }
    const filter = and.length ? { $and: and } : {};
    const [total, rows] = await Promise.all([
      LeaveType.countDocuments(filter),
      LeaveType.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    ]);
    return res.json({
      count: rows.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data: rows.map(mapType),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createType = async (req, res) => {
  try {
    const code = String(req.body.code).trim().toUpperCase();
    const scopeName = req.body.scope === "company" ? "company" : "common";
    let companyId = null;
    if (scopeName === "company") {
      const picked = pickCompany(req.user, req.body.companyId);
      if (picked.error) return res.status(400).json({ message: picked.error });
      companyId = picked.companyId;
    }
    const exists = await LeaveType.findOne(
      scopeName === "common"
        ? { scope: "common", code }
        : { scope: "company", companyId, code }
    );
    if (exists && !exists.hidden) return res.status(400).json({ message: "Leave code already exists" });
    if (exists && exists.hidden) {
      exists.hidden = false;
      exists.name = req.body.name.trim();
      exists.paid = req.body.paid;
      exists.maxDays = req.body.isUnlimited ? null : req.body.maxDays;
      exists.allocationType = req.body.allocationType || "yearly";
      exists.quarterlyLimit = req.body.quarterlyLimit ?? null;
      exists.isUnlimited = !!req.body.isUnlimited;
      exists.carryForward = req.body.carryForward;
      exists.status = req.body.status || "Active";
      await exists.save();
      await pushTypeToBalances(exists);
      return res.status(201).json({ message: "Leave type added for this company", data: mapType(exists) });
    }
    const type = await LeaveType.create({
      scope: scopeName,
      companyId,
      name: req.body.name.trim(),
      code,
      paid: req.body.paid,
      maxDays: req.body.isUnlimited ? null : req.body.maxDays,
      allocationType: req.body.allocationType || "yearly",
      quarterlyLimit: req.body.quarterlyLimit ?? null,
      isUnlimited: !!req.body.isUnlimited,
      carryForward: req.body.carryForward,
      status: req.body.status || "Active",
    });
    await pushTypeToBalances(type);
    return res.status(201).json({ message: "Leave type added", data: mapType(type) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const seedDefaultTypes = async (req, res) => {
  try {
    const scopeName = req.body.scope === "company" ? "company" : "common";
    let companyId = null;
    if (scopeName === "company") {
      const picked = pickCompany(req.user, req.body.companyId);
      if (picked.error) return res.status(400).json({ message: picked.error });
      companyId = picked.companyId;
    }
    const codes = DEFAULT_TYPES.map((t) => t.code);
    const existing = await LeaveType.find(
      scopeName === "common"
        ? { scope: "common", code: { $in: codes } }
        : { scope: "company", companyId, code: { $in: codes } }
    )
      .select("code")
      .lean();
    const have = new Set(existing.map((t) => t.code));
    const fresh = DEFAULT_TYPES.filter((t) => !have.has(t.code)).map((t) => ({
      ...t,
      scope: scopeName,
      companyId,
      status: t.status || "Active",
    }));
    const created = fresh.length ? await LeaveType.insertMany(fresh) : [];
    await Promise.all(created.map((t) => pushTypeToBalances(t)));
    const all = await LeaveType.find(
      scopeName === "common" ? { scope: "common" } : { scope: "company", companyId }
    )
      .sort({ name: 1 })
      .lean();
    return res.status(201).json({
      message: created.length ? "Default leave types added" : "Leave types already exist",
      added: created.length,
      data: all.map(mapType),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateType = async (req, res) => {
  try {
    const type = await LeaveType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: "Leave type not found" });
    const target = writeTarget(req);

    if (type.scope === "common" && !target.global) {
      if (target.error) return res.status(400).json({ message: target.error });
      let row = await LeaveType.findOne({
        scope: "company",
        companyId: target.companyId,
        code: type.code,
      });
      if (!row) {
        row = new LeaveType({
          scope: "company",
          companyId: target.companyId,
          name: type.name,
          code: type.code,
          paid: type.paid,
          maxDays: type.maxDays,
          allocationType: type.allocationType,
          quarterlyLimit: type.quarterlyLimit,
          isUnlimited: type.isUnlimited,
          carryForward: type.carryForward,
          status: type.status,
        });
      }
      applyTypeFields(row, req.body);
      row.hidden = false;
      const watchIds = [type._id, row._id];
      const wallets = await User.find({
        "official.companyIds": target.companyId,
        leaves: { $elemMatch: { year: leaveYear(), leaveType: { $in: watchIds } } },
      })
        .select("leaves")
        .lean();
      for (const bal of wallets) {
        for (const id of watchIds) {
          const item = leaveLine(bal, id, leaveYear());
          if (
            item &&
            !isEarnedType(row) &&
            row.allocationType !== "quarterly" &&
            round(poolOf(row, item) - item.used - item.pending) < 0
          ) {
            return res.status(400).json({
              message: `${row.name} is already used more than ${row.maxDays} days`,
            });
          }
        }
      }
      await row.save();
      const synced = await syncTypeOnBalances(row);
      if (!synced.ok) return res.status(400).json({ message: synced.message });
      return res.json({
        message: "Saved for this company. Common leave type is unchanged.",
        data: mapType(row),
      });
    }

    const denied = assertTypeWrite(req.user, type);
    if (denied) return res.status(403).json({ message: denied });
    if (req.body.code) {
      const code = String(req.body.code).trim().toUpperCase();
      const clash = await LeaveType.findOne({
        ...(type.scope === "common"
          ? { scope: "common" }
          : { scope: "company", companyId: type.companyId }),
        code,
        _id: { $ne: type._id },
      }).lean();
      if (clash) return res.status(400).json({ message: "Leave code already exists" });
    }
    applyTypeFields(type, req.body);
    const synced = await syncTypeOnBalances(type);
    if (!synced.ok) return res.status(400).json({ message: synced.message });
    await type.save();
    return res.json({ message: "Leave type updated", data: mapType(type) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deleteType = async (req, res) => {
  try {
    const type = await LeaveType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: "Leave type not found" });
    const rows = await LeaveType.find({ code: type.code }).select("_id").lean();
    const ids = rows.map((row) => row._id);
    const used = await LeaveRequest.exists({
      leaveType: { $in: ids },
      status: { $in: ["Pending", "Approved"] },
    });
    if (used) return res.status(400).json({ message: "Leave type is in use" });
    await User.updateMany(
      { "leaves.leaveType": { $in: ids } },
      {
        $pull: {
          leaves: { leaveType: { $in: ids } },
          leaveAdjustments: { leaveType: { $in: ids } },
        },
      }
    );
    await LeaveType.deleteMany({ _id: { $in: ids } });
    return res.json({ message: "Leave type deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const employeeFilter = (scope, query) => {
  const filter = { role: EMPLOYEE, status: "Active" };
  if (scope.ids) filter["official.companyIds"] = { $in: scope.ids };
  if (query.department) {
    filter["official.department"] = new RegExp(`^${escapeRegex(query.department)}$`, "i");
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { "official.employeeCode": rx }];
  }
  return filter;
};

const listBalances = async (req, res) => {
  try {
    const scope = companyScope(req.user, req.query.companyId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    const ids = scope.ids || (await companyIdsInUse(req));
    await ensureCompanyBalances(ids);
    const { page, limit, skip } = pageOf(req.query);
    const filter = employeeFilter(scope, req.query);
    if (isTeamScopedRole(req.user.role)) {
      filter._id = { $in: await getTeamMemberIds(req.user) };
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name profileUrl official.employeeCode official.department official.dateOfJoining leaves")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const year = leaveYear();
    const typeIds = [
      ...new Set(
        users.flatMap((user) =>
          (user.leaves || []).filter((row) => row.year === year).map((row) => String(row.leaveType))
        )
      ),
    ];
    const types = typeIds.length
      ? await LeaveType.find({ _id: { $in: typeIds } })
          .select("name code paid carryForward maxDays allocationType quarterlyLimit isUnlimited scope")
          .lean()
      : [];
    const typeMap = new Map(types.map((t) => [String(t._id), t]));
    for (const u of users) {
      const lines = (u.leaves || []).filter((row) => row.year === year);
      const monthStartDay = await monthStartForUser(u);
      for (const line of lines) {
        await rebuildQuarterLine(u, typeMap.get(String(line.leaveType)), line, monthStartDay);
      }
      u.monthStartDay = monthStartDay;
    }
    const data = users.map((u) => ({
      employee: {
        _id: u._id,
        name: u.name,
        employeeCode: u.official?.employeeCode || "",
        department: u.official?.department || "",
        profileUrl: u.profileUrl || "",
      },
      balances: (u.leaves || [])
        .filter((row) => row.year === year)
        .map((item) => presentItem(item, typeMap.get(String(item.leaveType)), u.official?.dateOfJoining, u.monthStartDay))
        .filter(Boolean),
    }));
    const withSummary = data.map((row) => ({ ...row, summary: summarizeBalances(row.balances) }));
    return res.json({
      year: yearLabel(year),
      count: withSummary.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data: withSummary,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const companyIdsInUse = async (req) => {
  if (!hasGlobalCompanyAccess(req.user)) return userCompanyIds(req.user);
  const ids = await User.distinct("official.companyIds", { role: EMPLOYEE, status: "Active" });
  return ids.filter(Boolean);
};

const adjustBalance = async (req, res) => {
  try {
    const employee = await loadEmployee(req.body.employeeId);
    if (!employee || !isEmployee(employee)) {
      return res.status(404).json({ message: "Employee not found" });
    }
    const denied = assertTeamOrCompanyEmployee(req.user, employee);
    if (denied) return res.status(403).json({ message: denied });
    const days = round(req.body.days);
    const year = leaveYear();
    await grantLeaveBalance(employee);
    const [balance, type] = await Promise.all([
      User.findById(employee._id).select("leaves leaveAdjustments"),
      LeaveType.findById(req.body.leaveTypeId).lean(),
    ]);
    const item = leaveLine(balance, req.body.leaveTypeId, year);
    if (!balance || !item || !type) {
      return res.status(404).json({ message: "Leave balance not found for this type" });
    }
    const monthStartDay = await monthStartForUser(employee);
    let credits = [];
    if (isQuarterlyType(type)) {
      const picked = casualAdjustCredit(req.body, year, monthStartDay);
      if (picked.error) return res.status(400).json({ message: picked.error });
      credits = picked.credits;
      if (round(days) !== credits.length) {
        return res.status(400).json({
          message: `Days must match the selected months. ${credits.length} month(s) means ${credits.length} day(s).`,
        });
      }
    }
    item.adjusted = round(item.adjusted + days);
    stampLine(item, type, employee.official?.dateOfJoining, monthStartDay);
    const reason = req.body.reason.trim();
    const at = new Date();
    if (credits.length) {
      for (const credit of credits) {
        balance.leaveAdjustments.push({
          leaveType: type._id,
          year,
          days: 1,
          month: credit.month,
          quarter: credit.quarter,
          reason,
          by: req.user._id,
          at,
        });
      }
    } else {
      balance.leaveAdjustments.push({
        leaveType: type._id,
        year,
        days,
        month: "",
        quarter: 0,
        reason,
        by: req.user._id,
        at,
      });
    }
    balance.markModified("leaves");
    await balance.save();
    const shown = presentItem(item, type, employee.official?.dateOfJoining, monthStartDay);
    const earned = isEarnedType(type);
    const adjustments = credits.map((credit) => ({
      ...adjustmentView({ month: credit.month, quarter: credit.quarter }, monthStartDay),
      days: 1,
      reason,
    }));
    const monthList = credits.map((credit) => credit.monthName).join(", ");
    const message = credits.length
      ? `${shown.name} increased by ${days} for ${monthList} (${credits[0].quarterCode}). The employee can use these days in any quarter.`
      : earned
        ? `${shown.name} earned increased by ${days}`
        : `${shown.name} remaining increased by ${days}`;
    return res.json({ message, data: shown, adjustments });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const requestScope = async (actor, query) => {
  const scope = companyScope(actor, query.companyId);
  if (scope.error) return scope;
  const filter = {};
  if (isTeamScopedRole(actor.role)) {
    filter.employee = { $in: await getTeamMemberIds(actor) };
    if (query.companyId) filter.companyId = query.companyId;
  } else if (scope.ids) {
    filter.companyId = { $in: scope.ids };
  }
  return { filter, companies: await companiesForActor(actor) };
};

const companiesForActor = async (actor) => {
  const scope = companyScope(actor);
  if (scope.error) return [];
  const filter = scope.ids ? { _id: { $in: scope.ids } } : {};
  const rows = await Company.find(filter)
    .select("companyName companyCode monthStartDay monthEndDay")
    .sort({ companyName: 1 })
    .lean();
  return rows.map(mapCompany);
};

const narrowEmployees = async (filter, query) => {
  if (!query.search && !query.department) return filter;
  const q = { role: EMPLOYEE };
  if (filter.employee) q._id = filter.employee;
  if (filter.companyId) q["official.companyIds"] = filter.companyId;
  if (query.department) {
    q["official.department"] = new RegExp(`^${escapeRegex(query.department)}$`, "i");
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    q.$or = [{ name: rx }, { "official.employeeCode": rx }];
  }
  const ids = await User.find(q).select("_id").lean();
  return { ...filter, employee: { $in: ids.map((row) => row._id) } };
};

const listRequests = async (req, res) => {
  try {
    const scoped = await requestScope(req.user, req.query);
    if (scoped.error) return res.status(403).json({ message: scoped.error });
    await releaseExpiredQuarterly();
    const filter = await narrowEmployees({ ...scoped.filter }, req.query);
    if (req.query.leaveTypeId) filter.leaveType = req.query.leaveTypeId;
    if (req.query.from) filter.to = { $gte: req.query.from };
    if (req.query.to) filter.from = { ...(filter.from || {}), $lte: req.query.to };
    const today = todayYmd();
    const { page, limit, skip } = pageOf(req.query);
    const statusFilter = leaveStatus(req.query.status);
    const listFilter = statusFilter ? { ...filter, status: statusFilter } : filter;
    const [total, rows, grouped, onLeaveToday] = await Promise.all([
      LeaveRequest.countDocuments(listFilter),
      LeaveRequest.find(listFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LeaveRequest.aggregate([
        { $match: filter },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
      LeaveRequest.countDocuments({
        ...filter,
        status: "Approved",
        from: { $lte: today },
        to: { $gte: today },
      }),
    ]);
    const summary = { all: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0, onLeaveToday };
    for (const row of grouped) {
      const key = String(row._id || "").toLowerCase();
      if (summary[key] !== undefined) summary[key] = row.n;
      summary.all += row.n;
    }
    return res.json({
      summary,
      companies: scoped.companies,
      count: rows.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data: await asRequests(rows),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const applyLeave = async (req, res) => {
  try {
    if (!isEmployee(req.user)) {
      return res.status(403).json({ message: "Only an employee can apply leave" });
    }
    const employee = req.user;
    const { from, to, dayType } = req.body;
    if (to < from) return res.status(400).json({ message: "To date is before from date" });
    const span = daysBetween(from, to);
    if (dayType === "Half Day" && span !== 1) {
      return res.status(400).json({ message: "Half day must be a single date" });
    }
    const days = dayType === "Half Day" ? 0.5 : span;
    const companyId = companyOf(employee);
    if (!companyId) return res.status(400).json({ message: "Your profile has no company" });
    await releaseExpiredQuarterly(employee._id);
    const monthStartDay = await monthStartForUser(employee);
    const blockedProbation = probationBlock(employee.official?.dateOfJoining, from, monthStartDay);
    if (blockedProbation) return res.status(400).json({ message: blockedProbation });
    const overlap = await LeaveRequest.exists({
      employee: employee._id,
      status: { $in: ["Pending", "Approved"] },
      from: { $lte: to },
      to: { $gte: from },
    });
    if (overlap) return res.status(400).json({ message: "Leave already applied for these dates" });

    const year = leaveYear(from, monthStartDay);
    if (year !== leaveYear(to, monthStartDay) || year !== leaveYear(todayYmd(), monthStartDay)) {
      return res.status(400).json({ message: "Leave dates must stay inside the current leave year (April–March)" });
    }
    await grantLeaveBalance(employee);
    const [wallet, catalog, unpaidType] = await Promise.all([
      User.findById(employee._id).select("leaves"),
      LeaveType.find({
        status: "Active",
        hidden: { $ne: true },
        $or: [{ scope: "common" }, { scope: "company", companyId }],
      }).lean(),
      unpaidTypeFor(companyId),
    ]);
    const paidTypes = typesForCompany(catalog, companyId).filter(
      (row) => row.status === "Active" && !row.hidden && !isUnpaidType(row)
    );
    const remainingOf = new Map();
    let paidLeft = 0;
    for (const row of paidTypes) {
      const line = leaveLine(wallet, row._id, year);
      const shown = line ? presentItem(line, row, employee.official?.dateOfJoining, monthStartDay) : null;
      const left = round(Math.max(0, shown?.remaining || 0));
      remainingOf.set(String(row._id), left);
      paidLeft = round(paidLeft + left);
    }
    const allPaidUsed = paidLeft <= 0;

    let type = null;
    if (req.body.leaveTypeId && !allPaidUsed) {
      type = catalog.find((row) => String(row._id) === String(req.body.leaveTypeId)) || null;
      if (!type || type.status !== "Active") {
        return res.status(400).json({ message: "Leave type is not active" });
      }
      const forThisCompany = type.scope === "common" || String(type.companyId) === String(companyId);
      if (!forThisCompany) {
        return res.status(400).json({ message: "Leave type is not for this company" });
      }
      if (isUnpaidType(type)) {
        return res.status(400).json({
          message: "Unpaid leave is applied automatically when paid leave is finished",
        });
      }
    }

    if (allPaidUsed || !type) {
      if (!allPaidUsed) {
        return res.status(400).json({ message: "Select a leave type. Unpaid leave is used when paid leave is finished" });
      }
      if (!unpaidType) return res.status(400).json({ message: "Unpaid leave is not configured" });
      const heldUnpaid = await holdDays(employee._id, unpaidType, days, "hold", []);
      if (heldUnpaid.error) return res.status(400).json({ message: heldUnpaid.error });
      const request = await LeaveRequest.create({
        employee: employee._id,
        companyId,
        leaveType: unpaidType._id,
        unpaidLeaveType: unpaidType._id,
        from,
        to,
        days,
        paidDays: 0,
        unpaidDays: days,
        deduction: days,
        adjustmentDays: 0,
        dayType,
        reason: req.body.reason.trim(),
        document: req.body.document || "",
        appliedBy: req.user._id,
      });
      await saveUnpaidOnUser(request, year);
      const [data, history] = await Promise.all([asRequests(request), employeeHistory(employee._id)]);
      return res.status(201).json({
        message: `Leave applied as Unpaid Leave. Salary deduction: ${days} day(s).`,
        data: data[0],
        history,
      });
    }

    const remaining = remainingOf.get(String(type._id)) || 0;
    if (remaining <= 0) {
      return res.status(400).json({
        message: `${type.name} is finished. Paid leave is still available on another type`,
      });
    }
    const paidDays = round(Math.min(days, remaining));
    const unpaidDays = round(days - paidDays);
    const slices = slicesFor(from, to, dayType, monthStartDay);
    const paidSlices = takeSlices(slices, paidDays);
    if (paidDays > 0 && isQuarterlyType(type)) {
      const collapsed = casualDatesError(employee.official?.dateOfJoining, from, to, monthStartDay);
      if (collapsed) return res.status(400).json({ message: collapsed });
    }
    if (unpaidDays > 0 && !unpaidType) {
      return res.status(400).json({ message: "Unpaid leave is not configured" });
    }

    let heldPaid = null;
    if (paidDays > 0) {
      heldPaid = await holdDays(employee._id, type, paidDays, "hold", paidSlices);
      if (heldPaid.error) return res.status(400).json({ message: heldPaid.error });
    }
    if (unpaidDays > 0) {
      const heldUnpaid = await holdDays(employee._id, unpaidType, unpaidDays, "hold", []);
      if (heldUnpaid.error) {
        if (paidDays > 0) {
          await holdDays(employee._id, type, paidDays, "release", paidSlices, heldPaid?.adjustmentDays || 0);
        }
        return res.status(400).json({ message: heldUnpaid.error });
      }
    }

    const request = await LeaveRequest.create({
      employee: employee._id,
      companyId,
      leaveType: type._id,
      unpaidLeaveType: unpaidDays > 0 ? unpaidType._id : null,
      from,
      to,
      days,
      paidDays,
      unpaidDays,
      deduction: unpaidDays,
      adjustmentDays: heldPaid?.adjustmentDays || 0,
      dayType,
      reason: req.body.reason.trim(),
      document: req.body.document || "",
      appliedBy: req.user._id,
    });
    await saveUnpaidOnUser(request, year);
    const [data, history] = await Promise.all([asRequests(request), employeeHistory(employee._id)]);
    const message =
      unpaidDays > 0
        ? `Leave applied. ${unpaidDays} day(s) are unpaid because paid leave is finished. Salary deduction: ${unpaidDays} day(s).`
        : "Leave applied";
    return res.status(201).json({
      message,
      data: data[0],
      history,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const decide = async (req, res, nextStatus) => {
  try {
    const request = await LeaveRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Leave request not found" });
    if (request.status !== "Pending") {
      return res.status(400).json({ message: "Leave request is already closed" });
    }
    if (String(request.employee) === String(req.user._id)) {
      return res.status(403).json({ message: "You cannot review your own leave" });
    }
    const employee = await loadEmployee(request.employee);
    const denied = assertTeamOrCompanyEmployee(req.user, employee);
    if (denied) return res.status(403).json({ message: denied });

    const type = await LeaveType.findById(request.leaveType).lean();
    if (!type) return res.status(400).json({ message: "Leave type not found" });
    const unpaidRequest = round(request.unpaidDays || 0) > 0 || isUnpaidType(type);
    if (unpaidRequest) {
      const role = normalizeRoleName(req.user.role);
      const canReviewUnpaid = role === SUPER_ADMIN || role === HR || role === REPORTING_MANAGER;
      if (!canReviewUnpaid) {
        return res.status(403).json({
          message: "Unpaid leave can be approved only by Reporting Manager, HR, or Super Admin",
        });
      }
    }
    const monthStartDay = await monthStartForCompany(request.companyId);
    const paidPart = request.paidDays != null || request.unpaidDays != null ? round(request.paidDays || 0) : request.days;
    const openQuarterMiss = quarterlyDateError(request.from, request.to, todayYmd(), monthStartDay);
    const coveredByAdjust = round(request.adjustmentDays || 0) >= round(paidPart);
    if (nextStatus === "Approved" && paidPart > 0 && isQuarterlyType(type) && openQuarterMiss && !coveredByAdjust) {
      await settleRequestDays(request, "release", monthStartDay);
      await dropUnpaidOnUser(request);
      await request.deleteOne();
      return res.status(400).json({ message: openQuarterMiss });
    }
    const direction = nextStatus === "Approved" ? "approve" : "release";
    const moved = await settleRequestDays(request, direction, monthStartDay);
    if (moved.error) return res.status(400).json({ message: moved.error });

    request.status = nextStatus;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewReason = (req.body.reason || "").trim();
    await request.save();
    await syncUnpaidOnUser(request);
    const [data, history] = await Promise.all([asRequests(request), employeeHistory(request.employee)]);
    return res.json({
      message: nextStatus === "Approved" ? "Leave approved" : "Leave rejected",
      data: data[0],
      history,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const approveRequest = (req, res) => decide(req, res, "Approved");
const rejectRequest = (req, res) => decide(req, res, "Rejected");

const cancelRequest = async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Leave request not found" });
    if (request.status !== "Pending") {
      return res.status(400).json({ message: "Only a pending leave can be cancelled" });
    }
    const own = String(request.employee) === String(req.user._id);
    if (!own) {
      const employee = await loadEmployee(request.employee);
      const denied = assertTeamOrCompanyEmployee(req.user, employee);
      if (denied) return res.status(403).json({ message: denied });
    }
    const monthStartDay = await monthStartForCompany(request.companyId);
    const moved = await settleRequestDays(request, "release", monthStartDay);
    if (moved.error) return res.status(400).json({ message: moved.error });
    request.status = "Cancelled";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    await syncUnpaidOnUser(request);
    const [data, history] = await Promise.all([asRequests(request), employeeHistory(request.employee)]);
    return res.json({ message: "Leave cancelled", data: data[0], history });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const calendar = async (req, res) => {
  try {
    const scoped = await requestScope(req.user, req.query);
    if (scoped.error) return res.status(403).json({ message: scoped.error });
    const today = todayYmd();
    const month = req.query.month || today.slice(0, 7);
    const date = req.query.date || today;
    const { start, end, days, pad } = monthBounds(month);
    const filter = {
      ...scoped.filter,
      status: { $in: ["Pending", "Approved"] },
      from: { $lte: end },
      to: { $gte: start },
    };
    const scopedFilter = await narrowEmployees(filter, req.query);
    const rows = await LeaveRequest.find(scopedFilter)
      .select("employee leaveType days reason status from to")
      .lean();
    const dayRows = [];
    for (let d = 1; d <= days; d += 1) {
      const ymd = `${month}-${pad(d)}`;
      let onLeave = 0;
      let pending = 0;
      for (const row of rows) {
        if (row.from > ymd || row.to < ymd) continue;
        if (row.status === "Approved") onLeave += 1;
        else pending += 1;
      }
      dayRows.push({ date: ymd, onLeave, pending });
    }
    const selected = dayRows.find((d) => d.date === date) || { date, onLeave: 0, pending: 0 };
    const onDate = rows.filter((row) => row.from <= date && row.to >= date);
    const refs = await refsFor(onDate);
    const employees = onDate.map((row) => {
      const emp = refs.users.get(String(row.employee)) || {};
      const type = refs.types.get(String(row.leaveType)) || {};
      return {
        name: emp.name || "",
        employeeCode: emp.official?.employeeCode || "",
        department: emp.official?.department || "",
        leaveType: type.name || "",
        code: type.code || "",
        days: row.days,
        reason: row.reason,
        status: row.status,
      };
    });
    return res.json({
      month,
      date,
      summary: {
        onLeave: selected.onLeave,
        pending: selected.pending,
        approved: selected.onLeave,
      },
      days: dayRows,
      employees,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const policyKey = (label) =>
  String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word))
    .join("");

const mapPolicy = (row) => ({
  _id: row._id,
  scope: row.scope || (row.companyId ? "company" : "common"),
  companyId: row.scope === "common" ? null : row.companyId || null,
  key: row.key,
  label: row.label,
  value: row.value,
  description: row.description || "",
});

const policiesForCompany = (rows, companyId) => {
  const hidden = new Set(
    rows
      .filter((row) => row.hidden && row.scope !== "common" && String(row.companyId) === String(companyId))
      .map((row) => row.key)
  );
  const byKey = new Map();
  for (const row of rows) {
    if (row.hidden || hidden.has(row.key)) continue;
    const common = row.scope === "common" || (!row.scope && !row.companyId);
    const mine = !common && String(row.companyId) === String(companyId);
    if (!common && !mine) continue;
    if (!common) byKey.set(row.key, row);
    else if (!byKey.has(row.key)) byKey.set(row.key, row);
  }
  return [...byKey.values()];
};

const listPolicies = async (req, res) => {
  try {
    if (!req.query.companyId) {
      const filter = { scope: "common", hidden: { $ne: true } };
      if (req.query.search) filter.label = new RegExp(escapeRegex(req.query.search), "i");
      const rows = await LeavePolicy.find(filter).sort({ createdAt: 1 }).lean();
      return res.json({ count: rows.length, total: rows.length, data: rows.map(mapPolicy) });
    }
    const picked = pickCompany(req.user, req.query.companyId);
    if (picked.error) return res.status(400).json({ message: picked.error });
    const rows = await LeavePolicy.find({
      $or: [{ scope: "common" }, { companyId: picked.companyId }],
    }).lean();
    let data = policiesForCompany(rows, picked.companyId);
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), "i");
      data = data.filter((row) => rx.test(row.label));
    }
    data.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return res.json({ count: data.length, total: data.length, data: data.map(mapPolicy) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createPolicy = async (req, res) => {
  try {
    const scopeName = req.body.scope === "company" ? "company" : "common";
    let companyId = null;
    if (scopeName === "company") {
      const picked = pickCompany(req.user, req.body.companyId);
      if (picked.error) return res.status(400).json({ message: picked.error });
      companyId = picked.companyId;
    }
    const key = policyKey(req.body.label);
    const existing = await LeavePolicy.findOne(
      scopeName === "common" ? { scope: "common", key } : { companyId, key }
    );
    if (existing && !existing.hidden) {
      return res.status(400).json({ message: "Policy already exists" });
    }
    const fields = {
      scope: scopeName,
      companyId,
      key,
      label: req.body.label.trim(),
      value: req.body.value.trim(),
      description: (req.body.description || "").trim(),
      hidden: false,
    };
    const row = existing
      ? Object.assign(existing, fields)
      : new LeavePolicy(fields);
    await row.save();
    return res.status(201).json({
      message: scopeName === "common" ? "Common policy added" : "Policy added for this company",
      data: mapPolicy(row),
    });
  } catch (err) {
    if (err?.code === 11000) return res.status(400).json({ message: "Policy already exists" });
    return res.status(500).json({ message: err.message });
  }
};

const updatePolicy = async (req, res) => {
  try {
    const row = await LeavePolicy.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Policy not found" });
    const target = writeTarget(req);
    const isCommon = row.scope === "common" || (!row.scope && !row.companyId);

    if (isCommon && !target.global) {
      if (target.error) return res.status(400).json({ message: target.error });
      let copy = await LeavePolicy.findOne({ companyId: target.companyId, key: row.key });
      if (!copy || copy.scope === "common") {
        copy = new LeavePolicy({
          scope: "company",
          companyId: target.companyId,
          key: row.key,
          label: row.label,
          value: row.value,
          description: row.description,
        });
      }
      if (req.body.label !== undefined) copy.label = req.body.label.trim();
      if (req.body.value !== undefined) copy.value = req.body.value.trim();
      if (req.body.description !== undefined) copy.description = req.body.description.trim();
      copy.scope = "company";
      copy.companyId = target.companyId;
      copy.hidden = false;
      await copy.save();
      return res.json({
        message: "Saved for this company. Common policy is unchanged.",
        data: mapPolicy(copy),
      });
    }

    if (!isCommon) {
      const scope = companyScope(req.user, row.companyId);
      if (scope.error) return res.status(403).json({ message: scope.error });
    }
    if (req.body.label !== undefined) row.label = req.body.label.trim();
    if (req.body.value !== undefined) row.value = req.body.value.trim();
    if (req.body.description !== undefined) row.description = req.body.description.trim();
    await row.save();
    return res.json({ message: "Policy updated", data: mapPolicy(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deletePolicy = async (req, res) => {
  try {
    const row = await LeavePolicy.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Policy not found" });
    await LeavePolicy.deleteMany({ key: row.key });
    return res.json({ message: "Policy deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const history = async (req, res) => {
  try {
    const scoped = await requestScope(req.user, req.query);
    if (scoped.error) return res.status(403).json({ message: scoped.error });
    const filter = {
      ...scoped.filter,
      status: { $in: ["Approved", "Rejected"] },
    };
    if (req.query.status === "Approved" || req.query.status === "Rejected") {
      filter.status = req.query.status;
    }
    if (req.query.leaveTypeId) filter.leaveType = req.query.leaveTypeId;
    if (req.query.department || req.query.search) {
      const narrowed = await narrowEmployees(filter, req.query);
      if (req.query.search) {
        const rx = new RegExp(escapeRegex(req.query.search), "i");
        const reviewers = await User.find({ name: rx }).select("_id").lean();
        filter.$or = [
          { employee: narrowed.employee },
          { reviewedBy: { $in: reviewers.map((row) => row._id) } },
        ];
      } else {
        filter.employee = narrowed.employee;
      }
    }
    const { page, limit, skip } = pageOf(req.query);
    const [total, rows] = await Promise.all([
      LeaveRequest.countDocuments(filter),
      LeaveRequest.find(filter).sort({ reviewedAt: -1 }).skip(skip).limit(limit).lean(),
    ]);
    const data = await asRequests(rows);
    return res.json({
      count: rows.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data: data.map((row) => ({
        ...row,
        approvedBy: row.reviewedBy,
        closedOn: row.reviewedAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const TYPE_ORDER = ["CL", "EL", "CO", "UL"];

/** Active leave types this employee can apply, with this year's balance. */
const leaveTypesForEmployee = async (user) => {
  const companyId = companyOf(user);
  if (!companyId) return { error: "Your profile has no company" };
  await releaseExpiredQuarterly(user._id);
  await grantLeaveBalance(user);
  const monthStartDay = await monthStartForUser(user);
  const year = leaveYear(todayYmd(), monthStartDay);
  const [rows, employee] = await Promise.all([
    LeaveType.find({
      status: "Active",
      hidden: { $ne: true },
      $or: [{ scope: "common" }, { scope: "company", companyId }],
    })
      .select("name code paid carryForward maxDays allocationType quarterlyLimit isUnlimited scope status companyId hidden")
      .lean(),
    User.findById(user._id).select("leaves").lean(),
  ]);
  const lines = (employee?.leaves || []).filter((row) => row.year === year);
  const visible = typesForCompany(rows, companyId).filter(
    (row) => row.status === "Active" && !row.hidden && !isUnpaidType(row)
  );
  for (const type of visible) {
    const line = lines.find((row) => String(row.leaveType) === String(type._id));
    if (line) await rebuildQuarterLine(employee, type, line, monthStartDay);
  }
  const data = visible
    .map((type) => {
      const line = lines.find((row) => String(row.leaveType) === String(type._id));
      const balance = line ? presentItem(line, type, user.official?.dateOfJoining, monthStartDay) : null;
      return {
        ...mapType(type),
        used: balance?.used || 0,
        pending: balance?.pending || 0,
        remaining: balance?.remaining ?? 0,
        earned: balance?.earned || 0,
        display: balance?.display || "",
        quarter: balance?.quarter || null,
      };
    })
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a.code);
      const ib = TYPE_ORDER.indexOf(b.code);
      if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  return { year: yearLabel(year), data };
};

/** Wallet plus which leave was used. Unpaid stays visible here; the apply dropdown hides it. */
const leaveBalanceSnapshot = async (user) => {
  const companyId = companyOf(user);
  if (!companyId) return { error: "Your profile has no company" };
  await releaseExpiredQuarterly(user._id);
  await grantLeaveBalance(user);
  const monthStartDay = await monthStartForUser(user);
  const year = leaveYear(todayYmd(), monthStartDay);
  const [rows, employee, requests] = await Promise.all([
    LeaveType.find({
      status: "Active",
      hidden: { $ne: true },
      $or: [{ scope: "common" }, { scope: "company", companyId }],
    })
      .select("name code paid carryForward maxDays allocationType quarterlyLimit isUnlimited scope status companyId hidden")
      .lean(),
    User.findById(user._id)
      .select("leaves unpaidLeaves official.dateOfJoining name official.employeeCode official.department")
      .lean(),
    LeaveRequest.find({
      employee: user._id,
      status: { $in: ["Pending", "Approved"] },
    })
      .sort({ from: -1 })
      .limit(200)
      .lean(),
  ]);
  const lines = (employee?.leaves || []).filter((row) => row.year === year);
  const visible = typesForCompany(rows, companyId).filter((row) => row.status === "Active" && !row.hidden);
  for (const type of visible) {
    const line = lines.find((row) => String(row.leaveType) === String(type._id));
    if (line) await rebuildQuarterLine(employee, type, line, monthStartDay);
  }
  const balances = visible
    .map((type) => {
      const line = lines.find((row) => String(row.leaveType) === String(type._id));
      return line ? presentItem(line, type, user.official?.dateOfJoining, monthStartDay) : null;
    })
    .filter(Boolean);
  const typeName = new Map(visible.map((type) => [String(type._id), type]));
  const used = requests
    .filter((row) => leaveYear(row.from, monthStartDay) === year)
    .map((row) => {
      const type = typeName.get(String(row.leaveType)) || {};
      const split = row.paidDays != null || row.unpaidDays != null;
      const paidDays = split ? round(row.paidDays || 0) : type.paid === false ? 0 : row.days;
      const unpaidDays = split ? round(row.unpaidDays || 0) : type.paid === false ? row.days : 0;
      return {
        _id: row._id,
        leaveType: type.name || "",
        code: type.code || "",
        from: row.from,
        to: row.to,
        days: row.days,
        paidDays,
        unpaidDays,
        deduction: row.deduction != null ? round(row.deduction) : unpaidDays,
        status: row.status,
        dayType: row.dayType,
      };
    });
  return {
    year: yearLabel(year),
    employee: {
      _id: user._id,
      name: employee?.name || user.name || "",
      employeeCode: employee?.official?.employeeCode || "",
      department: employee?.official?.department || "",
    },
    balances,
    summary: summarizeBalances(balances),
    used,
    unpaidLeaves: (employee?.unpaidLeaves || [])
      .filter((row) => !row.year || row.year === year)
      .map((row) => ({
        request: row.request,
        leaveType: row.leaveType,
        name: typeName.get(String(row.leaveType))?.name || "",
        code: typeName.get(String(row.leaveType))?.code || "",
        from: row.from,
        to: row.to,
        dates: row.dates || [],
        days: row.days,
        deduction: row.deduction,
        status: row.status,
      })),
  };
};

/** GET /api/leave/me/types — dropdown for Apply Leave. Unpaid is not listed. */
const myLeaveTypes = async (req, res) => {
  try {
    const listed = await leaveTypesForEmployee(req.user);
    if (listed.error) return res.status(400).json({ message: listed.error });
    return res.json({
      year: listed.year,
      count: listed.data.length,
      data: listed.data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/leave/me/balance — allotted, used, remaining, and salary deduction. */
const myLeaveBalance = async (req, res) => {
  try {
    const snapshot = await leaveBalanceSnapshot(req.user);
    if (snapshot.error) return res.status(400).json({ message: snapshot.error });
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/leave/employees/:employeeId/balance — same check for one employee. */
const employeeLeaveBalance = async (req, res) => {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(String(req.params.employeeId || ""))) {
      return res.status(400).json({ message: "Invalid employee id" });
    }
    const employee = await loadEmployee(req.params.employeeId);
    if (!employee || !isEmployee(employee)) {
      return res.status(404).json({ message: "Employee not found" });
    }
    const denied = assertTeamOrCompanyEmployee(req.user, employee);
    if (denied) return res.status(403).json({ message: denied });
    const snapshot = await leaveBalanceSnapshot(employee);
    if (snapshot.error) return res.status(400).json({ message: snapshot.error });
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Employee dashboard: leave request history for this leave year. */
const myLeave = async (req, res) => {
  try {
    const monthStartDay = await monthStartForUser(req.user);
    const year = leaveYear(todayYmd(), monthStartDay);
    await releaseExpiredQuarterly(req.user._id);
    const listed = await employeeLeavePage(req.user._id, req.query);
    const employee = await User.findById(req.user._id).select("leaveAdjustments").lean();
    const yearNotes = (employee?.leaveAdjustments || []).filter((row) => !row.year || row.year === year);
    const typeIds = yearNotes.map((row) => row.leaveType);
    const types = typeIds.length
      ? await LeaveType.find({ _id: { $in: typeIds } }).select("name code").lean()
      : [];
    const typeMap = new Map(types.map((type) => [String(type._id), type]));
    return res.json({
      year: yearLabel(year),
      summary: listed.summary,
      history: listed.history,
      count: listed.count,
      total: listed.total,
      page: listed.page,
      pages: listed.pages,
      adjustments: yearNotes.map((row) => ({
        leaveType: row.leaveType,
        name: typeMap.get(String(row.leaveType))?.name || "",
        code: typeMap.get(String(row.leaveType))?.code || "",
        days: row.days,
        ...adjustmentView(row, monthStartDay),
        reason: row.reason,
        by: row.by,
        at: row.at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listTypes,
  createType,
  seedDefaultTypes,
  updateType,
  deleteType,
  listBalances,
  adjustBalance,
  listRequests,
  applyLeave,
  approveRequest,
  rejectRequest,
  cancelRequest,
  calendar,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  history,
  myLeave,
  myLeaveTypes,
  myLeaveBalance,
  employeeLeaveBalance,
};
