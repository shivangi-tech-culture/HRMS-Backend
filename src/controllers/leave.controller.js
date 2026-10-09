/**
 * LEAVE
 * Types → yearly wallet on the employee → apply holds remaining →
 * reporting manager / HR / admin approves → used. Comp Off adjust adds days.
 */
const LeaveType = require("../models/LeaveType");
const LeaveRequest = require("../models/LeaveRequest");
const LeavePolicy = require("../models/LeavePolicy");
const User = require("../models/User");
const {
  round,
  todayYmd,
  leaveYear,
  yearLabel,
  companyOf,
  presentItem,
  stampLine,
  leaveLine,
  moveLeave,
  pushTypeToBalances,
  ensureCompanyBalances,
  grantLeaveBalance,
  syncTypeOnBalances,
  typesForCompany,
} = require("../utils/leaveBalance");
const {
  hasGlobalCompanyAccess,
  userCompanyIds,
  escapeRegex,
} = require("../utils/companyScope");
const { assertTeamOrCompanyEmployee, getTeamMemberIds } = require("../utils/teamScope");
const { EMPLOYEE, normalizeRoleName, isTeamScopedRole } = require("../config/roles");
const { DEFAULT_TYPES } = require("../utils/seedLeave");

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
  return { error: "companyId is required" };
};

const isEmployee = (user) => normalizeRoleName(user.role) === EMPLOYEE;

const mapType = (row) => ({
  _id: row._id,
  scope: row.scope || (row.companyId ? "company" : "common"),
  companyId: row.scope === "common" ? null : row.companyId || null,
  name: row.name,
  code: row.code,
  paid: row.paid,
  maxDays: row.maxDays,
  carryForward: row.carryForward,
  status: row.status,
});

const mapRequest = (row, refs) => {
  const emp = refs.users.get(String(row.employee)) || {};
  const type = refs.types.get(String(row.leaveType)) || {};
  const reviewer = row.reviewedBy ? refs.users.get(String(row.reviewedBy)) : null;
  const paid = !!type.paid;
  return {
    _id: row._id,
    employee: {
      _id: row.employee,
      name: emp.name || "",
      employeeCode: emp.official?.employeeCode || "",
      department: emp.official?.department || "",
    },
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
    paidDays: paid ? row.days : 0,
    unpaidDays: paid ? 0 : row.days,
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
  for (const row of list) {
    if (row.employee) userIds.add(String(row.employee));
    if (row.reviewedBy) userIds.add(String(row.reviewedBy));
    if (row.leaveType) typeIds.add(String(row.leaveType));
  }
  const [users, types] = await Promise.all([
    userIds.size
      ? User.find({ _id: { $in: [...userIds] } })
          .select("name official.employeeCode official.department")
          .lean()
      : [],
    typeIds.size
      ? LeaveType.find({ _id: { $in: [...typeIds] } }).select("name code paid").lean()
      : [],
  ]);
  return {
    users: new Map(users.map((u) => [String(u._id), u])),
    types: new Map(types.map((t) => [String(t._id), t])),
  };
};

const asRequests = async (rows) => {
  const refs = await refsFor(rows);
  return [].concat(rows).map((row) => mapRequest(row, refs));
};

const loadEmployee = async (id) => {
  const employee = await User.findById(id)
    .select("name role status official.employeeCode official.department official.companyIds official.reportingHead1 official.reportingHead2")
    .lean();
  return employee;
};

const holdDays = (employeeId, type, days, direction) =>
  moveLeave(employeeId, type, days, direction);

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
  if (body.maxDays !== undefined) type.maxDays = body.maxDays;
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
      exists.maxDays = req.body.maxDays;
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
      maxDays: req.body.maxDays,
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
          if (item && round(row.maxDays + item.adjusted - item.used - item.pending) < 0) {
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
        .select("name avatar official.employeeCode official.department leaves")
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
          .select("name code paid carryForward maxDays scope")
          .lean()
      : [];
    const typeMap = new Map(types.map((t) => [String(t._id), t]));
    const data = users.map((u) => ({
      employee: {
        _id: u._id,
        name: u.name,
        employeeCode: u.official?.employeeCode || "",
        department: u.official?.department || "",
        avatar: u.avatar || "",
      },
      balances: (u.leaves || [])
        .filter((row) => row.year === year)
        .map((item) => presentItem(item, typeMap.get(String(item.leaveType))))
        .filter(Boolean),
    }));
    return res.json({
      year: yearLabel(year),
      count: data.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data,
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
    item.adjusted = round(item.adjusted + days);
    stampLine(item, type.maxDays);
    balance.leaveAdjustments.push({
      leaveType: type._id,
      year,
      days,
      reason: req.body.reason.trim(),
      by: req.user._id,
      at: new Date(),
    });
    balance.markModified("leaves");
    await balance.save();
    const shown = presentItem(item, type);
    return res.json({
      message: `${shown.name} remaining increased by ${days}`,
      data: shown,
    });
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
  } else if (scope.ids) {
    filter.companyId = { $in: scope.ids };
  }
  return { filter };
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
    const filter = await narrowEmployees({ ...scoped.filter }, req.query);
    if (req.query.leaveTypeId) filter.leaveType = req.query.leaveTypeId;
    const today = todayYmd();
    const { page, limit, skip } = pageOf(req.query);
    const statusFilter = req.query.status && req.query.status !== "All" ? req.query.status : "";
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
    const summary = { all: 0, pending: 0, approved: 0, rejected: 0, onLeaveToday };
    for (const row of grouped) {
      const key = String(row._id || "").toLowerCase();
      if (summary[key] !== undefined) summary[key] = row.n;
      summary.all += row.n;
    }
    return res.json({
      summary,
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
    const self = isEmployee(req.user);
    const employeeId = self ? req.user._id : req.body.employeeId || req.user._id;
    const employee = self ? req.user : await loadEmployee(employeeId);
    if (!employee || !isEmployee(employee)) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (!self) {
      const denied = assertTeamOrCompanyEmployee(req.user, employee);
      if (denied) return res.status(403).json({ message: denied });
    }
    const { from, to, dayType } = req.body;
    if (to < from) return res.status(400).json({ message: "To date is before from date" });
    const span = daysBetween(from, to);
    if (dayType === "Half Day" && span !== 1) {
      return res.status(400).json({ message: "Half day must be a single date" });
    }
    const days = dayType === "Half Day" ? 0.5 : span;
    const type = await LeaveType.findById(req.body.leaveTypeId).lean();
    if (!type || type.status !== "Active") {
      return res.status(400).json({ message: "Leave type is not active" });
    }
    const companyId = companyOf(employee);
    const forThisCompany =
      type.scope === "common" || String(type.companyId) === String(companyId);
    if (!forThisCompany) {
      return res.status(400).json({ message: "Leave type is not for this company" });
    }
    const overlap = await LeaveRequest.exists({
      employee: employee._id,
      status: { $in: ["Pending", "Approved"] },
      from: { $lte: to },
      to: { $gte: from },
    });
    if (overlap) return res.status(400).json({ message: "Leave already applied for these dates" });

    const year = leaveYear(from);
    if (year !== leaveYear(to) || year !== leaveYear()) {
      return res.status(400).json({ message: "Leave dates must stay inside the current leave year (April–March)" });
    }
    await grantLeaveBalance(employee);
    const held = await holdDays(employee._id, type, days, "hold");
    if (held.error) return res.status(400).json({ message: held.error });

    const request = await LeaveRequest.create({
      employee: employee._id,
      companyId,
      leaveType: type._id,
      from,
      to,
      days,
      dayType,
      reason: req.body.reason.trim(),
      document: req.body.document || "",
      appliedBy: req.user._id,
    });
    const [data] = await asRequests(request);
    return res.status(201).json({
      message: "Leave applied",
      data,
      balance: held.item,
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
    const direction = nextStatus === "Approved" ? "approve" : "release";
    const moved = await holdDays(request.employee, type, request.days, direction);
    if (moved.error) return res.status(400).json({ message: moved.error });

    request.status = nextStatus;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewReason = (req.body.reason || "").trim();
    await request.save();
    const [data] = await asRequests(request);
    return res.json({
      message: nextStatus === "Approved" ? "Leave approved" : "Leave rejected",
      data,
      balance: moved.item,
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
    const type = await LeaveType.findById(request.leaveType).lean();
    if (!type) return res.status(400).json({ message: "Leave type not found" });
    const moved = await holdDays(request.employee, type, request.days, "release");
    if (moved.error) return res.status(400).json({ message: moved.error });
    request.status = "Cancelled";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    const [data] = await asRequests(request);
    return res.json({ message: "Leave cancelled", data, balance: moved.item });
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

/** Employee dashboard: wallet + applied + approved. */
const myLeave = async (req, res) => {
  try {
    const year = leaveYear();
    await ensureCompanyBalances([companyOf(req.user)].filter(Boolean));
    const [employee, applied, approved] = await Promise.all([
      User.findById(req.user._id).select("leaves leaveAdjustments").lean(),
      LeaveRequest.find({
        employee: req.user._id,
        status: { $in: ["Pending", "Rejected"] },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      LeaveRequest.find({ employee: req.user._id, status: "Approved" })
        .sort({ from: -1 })
        .limit(50)
        .lean(),
    ]);
    const yearLeaves = (employee?.leaves || []).filter((row) => row.year === year);
    const yearNotes = (employee?.leaveAdjustments || []).filter((row) => !row.year || row.year === year);
    const typeIds = [
      ...yearLeaves.map((item) => item.leaveType),
      ...yearNotes.map((row) => row.leaveType),
    ];
    const types = typeIds.length
      ? await LeaveType.find({ _id: { $in: typeIds } })
          .select("name code paid carryForward maxDays scope")
          .lean()
      : [];
    const typeMap = new Map(types.map((type) => [String(type._id), type]));
    const [appliedRows, approvedRows] = await Promise.all([
      asRequests(applied),
      asRequests(approved),
    ]);
    return res.json({
      year: yearLabel(year),
      balances: yearLeaves
        .map((item) => presentItem(item, typeMap.get(String(item.leaveType))))
        .filter(Boolean),
      adjustments: yearNotes.map((row) => ({
        leaveType: row.leaveType,
        name: typeMap.get(String(row.leaveType))?.name || "",
        code: typeMap.get(String(row.leaveType))?.code || "",
        days: row.days,
        reason: row.reason,
        by: row.by,
        at: row.at,
      })),
      applied: appliedRows,
      approved: approvedRows,
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
};
