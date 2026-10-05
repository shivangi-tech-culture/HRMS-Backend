/**
 * Shared helpers for Work module (Holiday / Weekly Off)
 */
const {
  hasGlobalCompanyAccess,
  companyNamesForUser,
  withDefaultCompany,
  normalizeCompany,
} = require("./companyScope");

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveCompany = async (req, bodyCompany) => {
  if (hasGlobalCompanyAccess(req.user)) {
    return withDefaultCompany(bodyCompany || "");
  }

  const names = await companyNamesForUser(req.user);
  const sent = String(bodyCompany || "").trim();
  if (
    sent &&
    names.some((name) => normalizeCompany(name) === normalizeCompany(sent))
  ) {
    return sent;
  }
  return names[0] || "";
};

const assertOwnCompany = async (req, companyName) => {
  if (hasGlobalCompanyAccess(req.user)) return null;
  const names = await companyNamesForUser(req.user);
  if (
    names.some((name) => normalizeCompany(name) === normalizeCompany(companyName))
  ) {
    return null;
  }
  return "Access denied for this company";
};

/** "Sat, Sun" | "Sun" | "Sat-Sun" → [0,6] */
const parseWeeklyOffLabel = (label) => {
  const raw = String(label || "").toLowerCase();
  const days = new Set();
  const map = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  for (const part of raw.split(/[,+/&\-]+/)) {
    const key = part.trim();
    if (map[key] != null) days.add(map[key]);
  }
  if (!days.size) return [0]; // default Sunday
  return [...days].sort((a, b) => a - b);
};

const formatWeeklyOffLabel = (days = []) => {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (days || []).map((d) => names[d] ?? "").filter(Boolean).join(", ");
};

module.exports = {
  escapeRegex,
  resolveCompany,
  assertOwnCompany,
  parseWeeklyOffLabel,
  formatWeeklyOffLabel,
  hasGlobalCompanyAccess,
  companyNamesForUser,
  normalizeCompany,
};
