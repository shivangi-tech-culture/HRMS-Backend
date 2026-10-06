/**
 * Attendance reason masters helper — load Active names from Master collections
 * Types: regularizationReason | markAttendanceReason
 */
const { getModel } = require("../models/Master");
const { companyNamesForUser, DEFAULT_COMPANY } = require("../utils/companyScope");
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
  const names = user ? await companyNamesForUser(user) : [];
  const company = names[0] || DEFAULT_COMPANY || "";

  const filter = { status: "Active" };
  if (company) {
    filter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
  }

  const rows = await Model.find(filter).select("name").sort({ name: 1 }).lean();
  if (rows.length) return rows.map((r) => r.name);

  // Fallback to UI catalog if not seeded yet
  return ATTENDANCE_DROPDOWNS[type] ? [...ATTENDANCE_DROPDOWNS[type]] : [];
};

module.exports = {
  listAttendanceMasterNames,
};
