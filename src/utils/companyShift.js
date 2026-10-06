/**
 * Catalog = Company tree. Assignment = User.official.branchId + shiftId.
 * Days stay on Company.branches[].shifts[].monthlySchedule.
 */
const Company = require("../models/Company");
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

const findBranchById = (company, branchId) => {
  const id = oid(branchId);
  if (!id) return null;
  return (company?.branches || []).find(
    (b) => oid(b._id) === id && b.isActive !== false
  );
};

const findShiftById = (branch, shiftId) => {
  const id = oid(shiftId);
  if (!id) return null;
  return (branch?.shifts || []).find(
    (s) => oid(s._id) === id && s.isActive !== false
  );
};

const publicBranch = (branch) =>
  branch
    ? {
        _id: branch._id,
        branchName: branch.branchName,
        branchCode: branch.branchCode,
      }
    : null;

const publicShift = (shift) =>
  shift
    ? {
        _id: shift._id,
        shiftName: shift.shiftName,
        shiftCode: shift.shiftCode,
      }
    : null;

const resolvePlacement = (companies, { branchId, shiftId }) => {
  const bId = oid(branchId);
  const sId = oid(shiftId);
  if (!bId && !sId) {
    return { ok: true, company: null, branch: null, shift: null };
  }
  if (!bId) {
    return {
      ok: false,
      status: 400,
      message: "official.branchId is required when shiftId is set",
    };
  }
  if (!companies.length) {
    return {
      ok: false,
      status: 400,
      message: "Company is required before branch / shift",
    };
  }

  for (const company of companies) {
    const branch = findBranchById(company, bId);
    if (!branch) continue;
    if (sId) {
      const shift = findShiftById(branch, sId);
      if (!shift) {
        return {
          ok: false,
          status: 400,
          message: `Shift is not on branch ${branch.branchName} of ${company.companyName}`,
        };
      }
      return { ok: true, company, branch, shift };
    }
    return { ok: true, company, branch, shift: null };
  }

  return { ok: false, status: 400, message: "Branch is not on the user's company" };
};

const assertUserPlacement = async ({ companyIds, branchId, shiftId }) => {
  const bId = oid(branchId);
  const sId = oid(shiftId);
  if (!bId && !sId) return { ok: true, company: null, branch: null, shift: null };

  const ids = (companyIds || []).map((id) => oid(id)).filter(Boolean);
  if (!ids.length) {
    return {
      ok: false,
      status: 400,
      message: "Company is required before branch / shift",
    };
  }

  const companies = await Company.find({ _id: { $in: ids } })
    .select("companyName branches")
    .lean();
  if (!companies.length) {
    return { ok: false, status: 400, message: "Company not found" };
  }
  return resolvePlacement(companies, { branchId: bId, shiftId: sId });
};

/** Response only: branchId / shiftId become { _id, name, code } like populated companyIds. */
const applyPublicPlacement = (official, placed) => {
  if (!official) return;
  official.branchId = placed?.ok ? publicBranch(placed.branch) : null;
  official.shiftId = placed?.ok ? publicShift(placed.shift) : null;
  delete official.branch;
  delete official.shift;
};

const attachPlacement = async (user) => {
  if (!user?.official) return user;
  const placed = await assertUserPlacement({
    companyIds: userCompanyIds(user),
    branchId: user.official.branchId,
    shiftId: user.official.shiftId,
  });
  applyPublicPlacement(user.official, placed);
  return user;
};

const attachPlacementMany = async (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.flatMap((row) => userCompanyIds(row)))];
  if (!ids.length) {
    for (const row of list) applyPublicPlacement(row?.official, null);
    return list;
  }
  const companies = await Company.find({ _id: { $in: ids } })
    .select("companyName branches")
    .lean();
  const byId = new Map(companies.map((c) => [oid(c._id), c]));
  for (const row of list) {
    if (!row?.official) continue;
    const owned = userCompanyIds(row)
      .map((id) => byId.get(id))
      .filter(Boolean);
    applyPublicPlacement(
      row.official,
      resolvePlacement(owned, {
        branchId: row.official.branchId,
        shiftId: row.official.shiftId,
      })
    );
  }
  return list;
};

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
  return day ? { day, shift: placed.shift, branch: placed.branch } : null;
};

module.exports = {
  parseOidOrNull,
  assertUserPlacement,
  attachPlacement,
  attachPlacementMany,
  getUserDaySchedule,
};
