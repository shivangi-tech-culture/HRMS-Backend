/**
 * COMPANY SCOPE — who may see / change which company
 *
 * Super Admin / Admin → all companies
 * HR Manager          → official.companyIds (one or more)
 * Reporting Manager   → one id in official.companyIds (+ team via teamScope)
 * Employee            → one id in official.companyIds
 */
const {
  GLOBAL_COMPANY_ROLES,
  MULTI_COMPANY_ROLES,
  normalizeRoleName,
  canAssignCompanies: hierarchyCanAssignCompanies,
  isMultiCompanyRole: hierarchyIsMultiCompanyRole,
  hasGlobalCompanyRole,
  isPlatformRole,
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

/** Company _ids stored on the user (strings). Works with raw or populated companyIds. */
const userCompanyIds = (user) => {
  const raw = user?.official?.companyIds || user?.companyIds || [];
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.map((id) => String(id?._id || id || "").trim()).filter(Boolean)
    ),
  ];
};

/** Mongoose populate option for User.official.companyIds → { _id, companyName } */
const COMPANY_POPULATE = { path: "official.companyIds", select: "companyName" };

/** [{ _id, companyName }] from a user whose official.companyIds is populated. */
const companyRefs = (user) =>
  (Array.isArray(user?.official?.companyIds) ? user.official.companyIds : [])
    .filter((c) => c && c.companyName !== undefined)
    .map((c) => ({ _id: c._id, companyName: c.companyName || "" }));

/** @deprecated Name is not stored on the user. Use companyNamesForUser. */
const getUserCompany = () => "";

/** True if actor is Super Admin or Admin (all companies) */
const hasGlobalCompanyAccess = (user) =>
  hasGlobalCompanyRole(user?.role) ||
  GLOBAL_COMPANY_ROLES.includes(normalizeRoleName(user?.role));

/** True when actor may assign more than one company id to HR (Super Admin only) */
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
 * Company names for display / holiday rows (not stored on the user).
 * Super Admin and Admin → every active company. Others → their companyIds.
 */
const companyNamesForUser = async (user) =>
  (await companyListForUser(user)).map((row) => row.companyName);

/**
 * Sync name list is gone. Names are loaded with companyNamesForUser.
 * Super/Admin → null (all). Others → [] here; do not use for access checks.
 */
const getAccessibleCompanies = (user) => {
  if (hasGlobalCompanyAccess(user)) return null;
  return [];
};

/** True when both values refer to the same company name */
const isSameCompany = (companyA, companyB) => {
  const a = normalizeCompany(companyA);
  const b = normalizeCompany(companyB);
  return Boolean(a && b && a === b);
};

/** True if actor and employee share at least one company id. */
const sharesCompany = (actor, employee) => {
  if (hasGlobalCompanyAccess(actor)) return true;
  const mine = new Set(userCompanyIds(actor));
  if (!mine.size) return false;
  return userCompanyIds(employee).some((id) => mine.has(id));
};

/** True if actor may act on targetCompany name (holiday / weekly off rows). */
const canAccessCompany = async (actor, targetCompany) => {
  if (hasGlobalCompanyAccess(actor)) return true;
  const target = normalizeCompany(targetCompany);
  if (!target) return false;
  const names = await companyNamesForUser(actor);
  return names.some((name) => normalizeCompany(name) === target);
};

/** Error message if actor cannot act on a company name; null if ok */
const assertSameCompany = async (actor, targetCompany) => {
  if (hasGlobalCompanyAccess(actor)) return null;
  const names = await companyNamesForUser(actor);
  if (!names.length) {
    return "Your profile has no company — cannot manage employees";
  }
  if (!(await canAccessCompany(actor, targetCompany))) {
    return names.length === 1
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
  if (!userCompanyIds(actor).length) {
    return "Your profile has no company — cannot manage employees";
  }
  if (!sharesCompany(actor, employee)) {
    return userCompanyIds(actor).length === 1
      ? "You can only manage employees for your own company"
      : "You can only manage employees for your assigned companies";
  }
  return null;
};

/**
 * Mongo filter for user list APIs.
 * null = all companies; false = block; object = scoped filter on companyIds.
 */
const companyFilter = (actor) => {
  if (hasGlobalCompanyAccess(actor)) return null;
  const ids = userCompanyIds(actor);
  if (!ids.length) return false;
  return { "official.companyIds": { $in: ids } };
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

/**
 * Company from a query/body value — 24-hex _id or exact company name.
 * Returns { _id, companyName } or null when nothing matches.
 */
const findCompany = async (value) => {
  const Company = require("../models/Company");
  const v = String(value || "").trim();
  if (!v) return null;
  const filter = /^[a-fA-F0-9]{24}$/.test(v)
    ? { _id: v }
    : { companyName: companyExactRegex(v), isActive: true };
  return Company.findOne(filter).select("companyName").lean();
};

/** Given company, or DEFAULT_COMPANY if empty */
const withDefaultCompany = (company) => {
  const value = String(company || "").trim();
  return value || DEFAULT_COMPANY;
};

/**
 * Dropdown for create-employee / Access & Control.
 * Super Admin and Admin → every active company.
 * HR → official.companyIds. Employee → that one id inside companyIds.
 */
const companyListForUser = async (user) => {
  const Company = require("../models/Company");

  if (hasGlobalCompanyAccess(user)) {
    const rows = await Company.find({ isActive: true })
      .select("companyName")
      .sort({ companyName: 1 })
      .lean();
    return rows.map((row) => ({
      companyId: row._id,
      companyName: row.companyName,
    }));
  }

  const ids = userCompanyIds(user);

  if (!ids.length) return [];

  const rows = await Company.find({ _id: { $in: ids }, isActive: true })
    .select("companyName")
    .lean();
  const byId = new Map(rows.map((row) => [String(row._id), row.companyName]));
  return ids
    .filter((id) => byId.has(String(id)))
    .map((id) => ({ companyId: id, companyName: byId.get(String(id)) }));
};

/**
 * Save official.companyIds on the user being created.
 * Employee / Reporting Manager: array length must be 1.
 * HR: one or more ids.
 */
const attachCompany = async (actor, roleName, officialIn = {}) => {
  const Company = require("../models/Company");
  const role = normalizeRoleName(roleName);

  if (isPlatformRole(role)) {
    return { ok: true, company: "", companyIds: [], companies: [] };
  }

  const multi = isMultiCompanyRole(role);
  let ids = Array.isArray(officialIn.companyIds) ? officialIn.companyIds : [];
  if (!ids.length && officialIn.company) {
    const named = await Company.findOne({
      companyName: companyExactRegex(officialIn.company),
      isActive: true,
    })
      .select("_id")
      .lean();
    if (!named) {
      return { ok: false, status: 400, message: `Company not found: ${officialIn.company}` };
    }
    ids = [named._id];
  }

  ids = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!ids.length) {
    return {
      ok: false,
      status: 400,
      message: "official.companyIds is required",
    };
  }
  if (!multi && ids.length > 1) {
    return {
      ok: false,
      status: 400,
      message: "Employee and Reporting Manager can have only one company",
    };
  }
  if (multi && ids.length > 1 && !canAssignCompanies(actor)) {
    return {
      ok: false,
      status: 403,
      message: "Only Super Admin can assign more than one company to HR",
    };
  }

  const docs = await Company.find({ _id: { $in: ids }, isActive: true })
    .select("companyName")
    .lean();
  if (docs.length !== ids.length) {
    return { ok: false, status: 400, message: "Company not found or inactive" };
  }
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const ordered = ids.map((id) => byId.get(id));

  if (!hasGlobalCompanyAccess(actor)) {
    const allowed = new Set(
      (await companyListForUser(actor)).map((row) => String(row.companyId))
    );
    const blocked = ordered.find((doc) => !allowed.has(String(doc._id)));
    if (blocked) {
      return {
        ok: false,
        status: 403,
        message: `Pick a company from your list (${blocked.companyName} is not assigned to you)`,
      };
    }
  }

  return {
    ok: true,
    company: ordered[0].companyName,
    companyIds: ordered.map((doc) => doc._id),
    companies: ordered.map((doc) => doc.companyName),
  };
};

/** Write official.companyIds only. Company name is not copied onto the user. */
const writeCompanyFields = (official, assigned, roleName) => {
  const role = normalizeRoleName(roleName);
  const next = { ...official };
  delete next.company;
  delete next.companies;
  delete next.branch;
  delete next.shift;

  if (isPlatformRole(role) || !assigned.companyIds?.length) {
    next.companyIds = undefined;
    next.branchId = undefined;
    next.shiftId = undefined;
    return next;
  }

  next.companyIds = assigned.companyIds;
  return next;
};

module.exports = {
  DEFAULT_COMPANY,
  GLOBAL_COMPANY_ROLES,
  MULTI_COMPANY_ROLES,
  normalizeCompany,
  escapeRegex,
  companyExactRegex,
  getUserCompany,
  userCompanyIds,
  COMPANY_POPULATE,
  companyRefs,
  hasGlobalCompanyAccess,
  canAssignCompanies,
  isMultiCompanyRole,
  normalizeCompaniesList,
  companyNamesForUser,
  getAccessibleCompanies,
  sharesCompany,
  isSameCompany,
  canAccessCompany,
  assertSameCompany,
  assertSameCompanyEmployee,
  companyFilter,
  mergeAssignedCompanies,
  findCompany,
  withDefaultCompany,
  companyListForUser,
  attachCompany,
  writeCompanyFields,
};
