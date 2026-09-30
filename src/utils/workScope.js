/**
 * Shared helpers for Work module (Shift / Assignment / Holiday / Timings / Weekly Off)
 */
const {
  hasGlobalCompanyAccess,
  getUserCompany,
  getAccessibleCompanies,
  canAccessCompany,
  withDefaultCompany,
  normalizeCompany,
} = require("./companyScope");

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveCompany = (req, bodyCompany) => {
  if (hasGlobalCompanyAccess(req.user)) {
    return withDefaultCompany(bodyCompany || getUserCompany(req.user));
  }

  const sent = String(bodyCompany || "").trim();
  if (sent) {
    if (!canAccessCompany(req.user, sent)) {
      return String(req.user?.official?.company || "").trim() || withDefaultCompany("");
    }
    return sent;
  }

  const own = String(req.user?.official?.company || "").trim();
  return own || withDefaultCompany("");
};

const assertOwnCompany = (req, companyName) => {
  if (hasGlobalCompanyAccess(req.user)) return null;
  if (canAccessCompany(req.user, companyName)) return null;

  const accessible = getAccessibleCompanies(req.user) || [];
  return accessible.length > 1
    ? "Access denied for this company"
    : "Access denied for this company";
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
  getUserCompany,
  getAccessibleCompanies,
  canAccessCompany,
  normalizeCompany,
};
