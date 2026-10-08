/**
 * ATTENDANCE-ONLY placement helper (READ, never writes User / Company).
 *
 * Why separate from companyShift.js?
 * - companyShift.js → employee assign / list (attachPlacement, assertUserPlacement)
 * - THIS file → punch-in/out, daily attendance, calendar display only
 *
 * Safe rules:
 * - Never mutates user.official / company docs
 * - Only READS companyIds + branchId + shiftId already saved on the user
 * - Returns plain objects for attendance API responses
 */
// READ-ONLY check that user's saved branch/shift sit on their company tree.
// Never calls attachPlacement (that mutates response official for employee APIs).
const { assertUserPlacement } = require("./companyShift");
const { getModel } = require("../models/Master");
const { userCompanyIds } = require("./companyScope");

/** Normalize id → string */
const oid = (value) => {
  if (value === undefined || value === null || value === "") return "";
  return String(value._id || value).trim();
};

/** Load branch/shift master names (attendance display only) */
const loadNames = async (branchIds, shiftIds) => {
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

/**
 * For one employee + date → company, branch, shift, and that day's timings.
 * Used ONLY by attendance (via shiftTiming.getAssignedShift).
 *
 * @returns {{ day, company, branch, shift } | null}
 */
const getAttendanceDayPlacement = async (user, dateStr) => {
  // READ placement that is already assigned on the user (does not change it)
  const placed = await assertUserPlacement({
    companyIds: userCompanyIds(user),
    branchId: user?.official?.branchId,
    shiftId: user?.official?.shiftId,
  });
  if (!placed.ok || !placed.shift) return null;

  // Pick week 1–5 + weekday from company shift monthlySchedule
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
  const day = (week?.days || []).find((d) => d.day === weekday) || null;

  const bId = oid(placed.branch?.branchId);
  const sId = oid(placed.shift.shiftId);
  const names = await loadNames(bId ? [bId] : [], sId ? [sId] : []);
  const branchMaster = bId ? names.get(bId) : null;
  const shiftMaster = sId ? names.get(sId) : null;

  // Company / branch / shift stay even when today's weekday row is missing.
  return {
    day, // { day, startTime, endTime, isOff, ... } or null
    company: placed.company
      ? {
          _id: placed.company._id,
          companyName: placed.company.companyName || "",
        }
      : null,
    branch: branchMaster
      ? {
          _id: branchMaster._id,
          name: branchMaster.name,
          code: branchMaster.code || "",
          address: placed.branch?.address || "",
          city: placed.branch?.city || "",
          state: placed.branch?.state || "",
        }
      : null,
    shift: shiftMaster, // { _id, name, code }
  };
};

module.exports = {
  getAttendanceDayPlacement,
};
