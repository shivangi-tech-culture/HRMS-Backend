/**
 * Attendance reason masters helper — load Active names from Master collections
 * Types: regularizationReason | markAttendanceReason
 */
const { getModel } = require("../models/Master");
const { getUserCompany, DEFAULT_COMPANY } = require("../utils/companyScope");
const { ATTENDANCE_DROPDOWNS } = require("../config/generalInfoMasters");

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} type — regularizationReason | markAttendanceReason
 * @param {object} [user] — req.user (company scope)
 * @returns {Promise<string[]>}
 */
const listAttendanceMasterNames = async (type, user) => {
  const Model = getModel(type);
  const company =
    (user && getUserCompany(user)) || DEFAULT_COMPANY || "";

  const filter = { status: "Active" };
  if (company) {
    filter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
  }

  const rows = await Model.find(filter).select("name").sort({ name: 1 }).lean();
  if (rows.length) return rows.map((r) => r.name);

  // Fallback to UI catalog if not seeded yet
  return ATTENDANCE_DROPDOWNS[type] ? [...ATTENDANCE_DROPDOWNS[type]] : [];
};

/** Upsert attendance reason masters for a company (idempotent) */
const ensureAttendanceReasonMasters = async (company = DEFAULT_COMPANY) => {
  let created = 0;
  for (const [type, names] of Object.entries(ATTENDANCE_DROPDOWNS)) {
    const Model = getModel(type);
    for (const name of names) {
      const existing = await Model.findOne({
        company,
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      });
      if (!existing) {
        await Model.create({ name, company, status: "Active" });
        created += 1;
      }
    }
  }
  return created;
};

module.exports = {
  listAttendanceMasterNames,
  ensureAttendanceReasonMasters,
};
