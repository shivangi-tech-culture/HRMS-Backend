/**
 * COMPANY ↔ BRANCH ↔ SHIFT placement (employee / Access & Control assign).
 *
 * Catalog  = Company.branches[].branchId → shifts[].shiftId (master ids)
 * Assignment = User.official.companyIds + branchId + shiftId
 *
 * Attendance punch does NOT use attachPlacement / applyPublicPlacement.
 * Punch reads via src/utils/attendancePlacement.js (separate, read-only).
 */
const Company = require("../models/Company");
const { getModel } = require("../models/Master");
const { userCompanyIds } = require("./companyScope");

const oid = (value) => {
  if (value === undefined || value === null || value === "") return "";
  return String(value._id || value).trim();
};

const parseOidOrNull = (value) => {
  if (value === undefined) return undefined;
  const id = oid(value);
  return /^[a-fA-F0-9]{24}$/.test(id) ? id : null;
};

const findBranch = (company, branchId) =>
  (company?.branches || []).find(
    (b) => oid(b.branchId) === branchId && b.isActive !== false
  );

const findShift = (branch, shiftId) =>
  (branch?.shifts || []).find(
    (s) => oid(s.shiftId) === shiftId && s.isActive !== false
  );

const resolvePlacement = (companies, { branchId, shiftId }) => {
  const bId = oid(branchId);
  const sId = oid(shiftId);
  if (!bId && !sId) return { ok: true, company: null, branch: null, shift: null };
  if (!bId) {
    return { ok: false, status: 400, message: "official.branchId is required when shiftId is set" };
  }
  if (!companies.length) {
    return { ok: false, status: 400, message: "Company is required before branch / shift" };
  }

  for (const company of companies) {
    const branch = findBranch(company, bId);
    if (!branch) continue;
    if (!sId) return { ok: true, company, branch, shift: null };
    const shift = findShift(branch, sId);
    if (!shift) {
      return {
        ok: false,
        status: 400,
        message: `Shift is not on this branch of ${company.companyName}`,
      };
    }
    return { ok: true, company, branch, shift };
  }
  return { ok: false, status: 400, message: "Branch is not on the user's company" };
};

const loadCompanies = (ids) =>
  Company.find({ _id: { $in: ids } }).select("companyName branches").lean();

const assertUserPlacement = async ({ companyIds, branchId, shiftId }) => {
  const bId = oid(branchId);
  const sId = oid(shiftId);
  if (!bId && !sId) return { ok: true, company: null, branch: null, shift: null };

  const ids = (companyIds || []).map((id) => oid(id)).filter(Boolean);
  if (!ids.length) {
    return { ok: false, status: 400, message: "Company is required before branch / shift" };
  }
  const companies = await loadCompanies(ids);
  if (!companies.length) return { ok: false, status: 400, message: "Company not found" };
  return resolvePlacement(companies, { branchId: bId, shiftId: sId });
};

/** Map of master _id → { _id, name, code } for the given branch / shift ids */
const loadMasterNames = async (branchIds, shiftIds) => {
  const pick = (type, ids) =>
    ids.length
      ? getModel(type).find({ _id: { $in: ids } }).select("name code").lean()
      : [];
  const [branches, shifts] = await Promise.all([
    pick("branch", [...new Set(branchIds)]),
    pick("shift", [...new Set(shiftIds)]),
  ]);
  const byId = new Map();
  for (const m of [...branches, ...shifts]) {
    byId.set(oid(m._id), { _id: m._id, name: m.name, code: m.code || "" });
  }
  return byId;
};

/** Response only: branchId / shiftId become { _id, name, code } like populated companyIds (lists stop here). */
const applyPublicPlacement = (official, placed, names) => {
  if (!official) return;
  const bId = placed?.ok && placed.branch ? oid(placed.branch.branchId) : "";
  const sId = placed?.ok && placed.shift ? oid(placed.shift.shiftId) : "";
  official.branchId = (bId && names.get(bId)) || null;
  official.shiftId = (sId && names.get(sId)) || null;
  delete official.branch;
  delete official.shift;
};

const placedIds = (placed) => ({
  b: placed?.ok && placed.branch ? [oid(placed.branch.branchId)] : [],
  s: placed?.ok && placed.shift ? [oid(placed.shift.shiftId)] : [],
});

/** Single-user response: branch gets its company address, shift its company week 1–5 day timings */
const applyPlacementDetails = (official, placed) => {
  if (!placed?.ok) return;
  if (official.branchId && placed.branch) {
    const { address = "", city = "", state = "" } = placed.branch;
    Object.assign(official.branchId, { address, city, state });
  }
  if (official.shiftId && placed.shift) {
    official.shiftId.monthlySchedule = placed.shift.monthlySchedule || [];
  }
};

const attachPlacement = async (user) => {
  if (!user?.official) return user;
  const placed = await assertUserPlacement({
    companyIds: userCompanyIds(user),
    branchId: user.official.branchId,
    shiftId: user.official.shiftId,
  });
  const { b, s } = placedIds(placed);
  applyPublicPlacement(user.official, placed, await loadMasterNames(b, s));
  applyPlacementDetails(user.official, placed);
  return user;
};

const attachPlacementMany = async (rows) => {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.official);
  const ids = [...new Set(list.flatMap((row) => userCompanyIds(row)))];
  const companies = ids.length ? await loadCompanies(ids) : [];
  const byId = new Map(companies.map((c) => [oid(c._id), c]));

  const placements = list.map((row) =>
    resolvePlacement(
      userCompanyIds(row).map((id) => byId.get(id)).filter(Boolean),
      { branchId: row.official.branchId, shiftId: row.official.shiftId }
    )
  );
  const all = placements.map(placedIds);
  const names = await loadMasterNames(
    all.flatMap((x) => x.b),
    all.flatMap((x) => x.s)
  );
  list.forEach((row, i) => applyPublicPlacement(row.official, placements[i], names));
  return rows;
};

/**
 * READ-ONLY day timings from company tree for a date.
 * Returns { day, shift: { _id, name, code } } or null.
 *
 * IMPORTANT: Do NOT use this to change employee assignment.
 * Company / employee assign still uses assertUserPlacement + attachPlacement only.
 * Attendance punch uses src/utils/attendancePlacement.js (separate helper).
 */
const getUserDaySchedule = async (user, dateStr) => {
  const placed = await assertUserPlacement({
    companyIds: userCompanyIds(user),
    branchId: user?.official?.branchId,
    shiftId: user?.official?.shiftId,
  });
  if (!placed.ok || !placed.shift) return null;

  const date = new Date(`${String(dateStr).slice(0, 10)}T12:00:00+05:30`);
  const weekNumber = Math.min(5, Math.ceil(date.getUTCDate() / 7));
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][date.getUTCDay()];
  const weeks = placed.shift.monthlySchedule || [];
  const week =
    weeks.find((w) => w.weekNumber === weekNumber) ||
    weeks.find((w) => w.weekNumber === 4) ||
    weeks[0];
  const day = (week?.days || []).find((d) => d.day === weekday);
  if (!day) return null;

  const sId = oid(placed.shift.shiftId);
  const names = await loadMasterNames([], [sId]);
  return { day, shift: names.get(sId) || null };
};

module.exports = {
  parseOidOrNull,
  assertUserPlacement,
  attachPlacement,
  attachPlacementMany,
  getUserDaySchedule,
};
