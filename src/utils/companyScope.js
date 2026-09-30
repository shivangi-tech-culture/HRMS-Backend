/**
 * COMPANY SCOPE — who may see / change which company
 *
 * Super Admin / Admin → all companies
 * HR Manager          → official.company + official.companies[] (Super Admin assigns)
 * Reporting Manager   → single official.company (+ team via teamScope)
 * Employee            → own company
 */
const {
  GLOBAL_COMPANY_ROLES,
  MULTI_COMPANY_ROLES,
  normalizeRoleName,
  canAssignCompanies: hierarchyCanAssignCompanies,
  isMultiCompanyRole: hierarchyIsMultiCompanyRole,
  hasGlobalCompanyRole,
} = require("../config/roles");

/** Default company when create body omits official.company (from .env or fallback) */
const DEFAULT_COMPANY =
  String(process.env.DEFAULT_COMPANY || "TechCulture.Ai Private Limited").trim();

/** Trim + lower-case for case-insensitive company compare */
const normalizeCompany = (value) => String(value || "").trim().toLowerCase();

/** Escape user text for safe RegExp */
const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive exact-match RegExp for one company name */
const companyExactRegex = (company) =>
  new RegExp(`^${escapeRegex(String(company).trim())}$`, "i");

/** Read primary company from user.official.company (normalized) */
const getUserCompany = (user) => normalizeCompany(user?.official?.company);

/** True if actor is Super Admin or Admin (all companies) */
const hasGlobalCompanyAccess = (user) =>
  hasGlobalCompanyRole(user?.role) ||
  GLOBAL_COMPANY_ROLES.includes(normalizeRoleName(user?.role));

/** True when actor may assign official.companies to HR (Super Admin only) */
const canAssignCompanies = (user) => hierarchyCanAssignCompanies(user);

/** True when role may hold multiple assigned companies (HR only) */
const isMultiCompanyRole = (roleName) => hierarchyIsMultiCompanyRole(roleName);

/**
 * Normalize body companies (array or comma-separated string) → unique trimmed names.
 */
const normalizeCompaniesList = (value) => {
  if (value == null || value === "") return [];
  const raw = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((s) => s.trim());
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = String(item || "").trim();
    if (!name) continue;
    const key = normalizeCompany(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

/**
 * Accessible company display names for scoped roles.
 * Super/Admin → null (means all). Others → unique list from company + companies[].
 * Reporting Manager ignores companies[] extras (single company only).
 */
const getAccessibleCompanies = (user) => {
  if (hasGlobalCompanyAccess(user)) return null;

  const role = normalizeRoleName(user?.role);
  const primary = String(user?.official?.company || "").trim();

  // Reporting Manager / Employee → primary only
  if (!MULTI_COMPANY_ROLES.includes(role)) {
    return primary ? [primary] : [];
  }

  const list = [];
  if (primary) list.push(primary);
  const extra = user?.official?.companies;
  if (Array.isArray(extra)) {
    for (const c of extra) {
      const name = String(c || "").trim();
      if (name) list.push(name);
    }
  }
  return normalizeCompaniesList(list);
};

/** True when both values refer to the same company */
const isSameCompany = (companyA, companyB) => {
  const a = normalizeCompany(companyA);
  const b = normalizeCompany(companyB);
  return Boolean(a && b && a === b);
};

/** True if actor may act on targetCompany */
const canAccessCompany = (actor, targetCompany) => {
  if (hasGlobalCompanyAccess(actor)) return true;
  const accessible = getAccessibleCompanies(actor);
  if (!accessible || !accessible.length) return false;
  const target = normalizeCompany(targetCompany);
  return accessible.some((c) => normalizeCompany(c) === target);
};

/** Error message if actor cannot act on targetCompany; null if ok */
const assertSameCompany = (actor, targetCompany) => {
  if (hasGlobalCompanyAccess(actor)) return null;

  const accessible = getAccessibleCompanies(actor);
  if (!accessible || !accessible.length) {
    return "Your profile has no company — cannot manage employees";
  }
  if (!canAccessCompany(actor, targetCompany)) {
    return accessible.length === 1
      ? "You can only manage employees for your own company"
      : "You can only manage employees for your assigned companies";
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
  return assertSameCompany(actor, employee?.official?.company);
};

/**
 * Mongo filter for list APIs.
 * null = all companies; false = block; object = scoped filter
 */
const companyFilter = (actor, field = "official.company") => {
  if (hasGlobalCompanyAccess(actor)) return null;

  const accessible = getAccessibleCompanies(actor);
  if (!accessible || !accessible.length) return false;

  if (accessible.length === 1) {
    return { [field]: companyExactRegex(accessible[0]) };
  }

  return {
    [field]: { $in: accessible.map((c) => companyExactRegex(c)) },
  };
};

/**
 * Merge primary company + companies[] for storage on HR.
 * Ensures primary is always included first when present.
 */
const mergeAssignedCompanies = (primaryCompany, companiesIn) => {
  const primary = String(primaryCompany || "").trim();
  const list = normalizeCompaniesList(companiesIn);
  if (primary) {
    const withoutPrimary = list.filter(
      (c) => normalizeCompany(c) !== normalizeCompany(primary)
    );
    return [primary, ...withoutPrimary];
  }
  return list;
};

/** Given company, or DEFAULT_COMPANY if empty */
const withDefaultCompany = (company) => {
  const value = String(company || "").trim();
  return value || DEFAULT_COMPANY;
};

module.exports = {
  DEFAULT_COMPANY,
  GLOBAL_COMPANY_ROLES,
  MULTI_COMPANY_ROLES,
  normalizeCompany,
  escapeRegex,
  companyExactRegex,
  getUserCompany,
  hasGlobalCompanyAccess,
  canAssignCompanies,
  isMultiCompanyRole,
  normalizeCompaniesList,
  getAccessibleCompanies,
  isSameCompany,
  canAccessCompany,
  assertSameCompany,
  assertSameCompanyEmployee,
  companyFilter,
  mergeAssignedCompanies,
  withDefaultCompany,
};
