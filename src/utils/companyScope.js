/**
 * COMPANY SCOPE — who may see / change which company
 * Global Admin → all; others → own company only.
 */
/** Default company when create body omits official.company (from .env or fallback) */
const DEFAULT_COMPANY =
  String(process.env.DEFAULT_COMPANY || "TechCulture.Ai Private Limited").trim();

/** Platform role that is not limited to one company */
const GLOBAL_COMPANY_ROLE = "Global Admin";

/** Trim + lower-case for case-insensitive company compare */
const normalizeCompany = (value) => String(value || "").trim().toLowerCase();

/** Read normalized company from user.official.company */
const getUserCompany = (user) => normalizeCompany(user?.official?.company);

/** True if actor is Global Admin (all companies) */
const hasGlobalCompanyAccess = (user) => user?.role === GLOBAL_COMPANY_ROLE;

/** True when both values refer to the same company */
const isSameCompany = (companyA, companyB) => {
  const a = normalizeCompany(companyA);
  const b = normalizeCompany(companyB);
  return Boolean(a && b && a === b);
};

/** Error message if actor cannot act on targetCompany; null if ok */
const assertSameCompany = (actor, targetCompany) => {
  if (hasGlobalCompanyAccess(actor)) return null;

  const actorCompany = getUserCompany(actor);
  if (!actorCompany) {
    return "Your profile has no company — cannot manage employees";
  }
  if (!isSameCompany(actorCompany, targetCompany)) {
    return "You can only manage employees for your own company";
  }
  return null;
};

/** Error message if actor cannot access employee; null if ok */
const assertSameCompanyEmployee = (actor, employee) => {
  if (!actor || !employee) {
    return "Access denied";
  }
  if (hasGlobalCompanyAccess(actor)) return null;
  if (String(actor._id) === String(employee._id)) return null;
  return assertSameCompany(actor, getUserCompany(employee));
};

/** Mongo company filter for list APIs (null = all, false = block) */
const companyFilter = (actor) => {
  if (hasGlobalCompanyAccess(actor)) return null; // no filter

  const company = getUserCompany(actor);
  if (!company) return false; // block

  return {
    "official.company": new RegExp(
      `^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    ),
  };
};

/** Given company, or DEFAULT_COMPANY if empty */
const withDefaultCompany = (company) => {
  const value = String(company || "").trim();
  return value || DEFAULT_COMPANY;
};

module.exports = {
  DEFAULT_COMPANY,
  GLOBAL_COMPANY_ROLE,
  normalizeCompany,
  getUserCompany,
  hasGlobalCompanyAccess,
  isSameCompany,
  assertSameCompany,
  assertSameCompanyEmployee,
  companyFilter,
  withDefaultCompany,
};
