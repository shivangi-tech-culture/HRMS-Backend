/**
 * Company scope helpers
 *
 * WHY THIS FILE:
 *   Multiple companies exist.
 *   Global Admin → every company (global).
 *   Super Admin / HR Manager / Manager → only their own company.
 *
 * USE ANYWHERE:
 *   const { assertSameCompany, hasGlobalCompanyAccess } = require("../utils/companyScope");
 *   const err = assertSameCompany(req.user, official.company);
 *   if (err) return res.status(403).json({ message: err });
 */

/** Platform role — not limited to one company */
const GLOBAL_COMPANY_ROLE = "Global Admin";

/** Normalize company name for compare (trim + lower case) */
const normalizeCompany = (value) => String(value || "").trim().toLowerCase();

/** Read company from a user / employee document */
const getUserCompany = (user) => normalizeCompany(user?.official?.company);

/** True if actor can manage every company */
const hasGlobalCompanyAccess = (user) => user?.role === GLOBAL_COMPANY_ROLE;

/**
 * True when both company values refer to the same company.
 * Empty on either side → false (no company = cannot match).
 */
const isSameCompany = (companyA, companyB) => {
  const a = normalizeCompany(companyA);
  const b = normalizeCompany(companyB);
  return Boolean(a && b && a === b);
};

/**
 * Actor may only act on their own company (unless Global Admin).
 *
 * @param {object} actor - logged-in user (req.user)
 * @param {string} targetCompany - company on create/update payload or target user
 * @returns {string|null} error message, or null if allowed
 */
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

/**
 * Actor may only access / update / delete an employee in the same company.
 * Global Admin → any employee. Own-record always allowed.
 *
 * @param {object} actor - req.user
 * @param {object} employee - target user document
 * @returns {string|null} error message, or null if allowed
 */
const assertSameCompanyEmployee = (actor, employee) => {
  if (!actor || !employee) {
    return "Access denied";
  }
  if (hasGlobalCompanyAccess(actor)) return null;
  if (String(actor._id) === String(employee._id)) return null;
  return assertSameCompany(actor, getUserCompany(employee));
};

/**
 * Mongo filter for list APIs.
 * Global Admin → null (no company filter — see all).
 * Company admin → { "official.company": /…/i }
 * No company on profile → false (caller should 403)
 */
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

module.exports = {
  GLOBAL_COMPANY_ROLE,
  normalizeCompany,
  getUserCompany,
  hasGlobalCompanyAccess,
  isSameCompany,
  assertSameCompany,
  assertSameCompanyEmployee,
  companyFilter,
};
