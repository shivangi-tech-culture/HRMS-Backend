/**
 * TEAM SCOPE — Reporting Manager sees only their direct reports
 *
 * Matching rules (any one is enough):
 *   employee.official.reportingHead1|2 equals manager's:
 *     - official.officialEmail
 *     - official.employeeCode
 *     - name
 *     - _id string
 */
const User = require("../models/User");
const {
  normalizeRoleName,
  REPORTING_MANAGER,
  EMPLOYEE,
  isTeamScopedRole,
} = require("../config/roles");
const {
  hasGlobalCompanyAccess,
  assertSameCompanyEmployee,
  companyFilter,
  getAccessibleCompanies,
} = require("./companyScope");

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Identity tokens used to match reportingHead1 / reportingHead2 */
const managerIdentityTokens = (manager) => {
  const tokens = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s) tokens.push(s);
  };
  push(manager?.official?.officialEmail);
  push(manager?.official?.employeeCode);
  push(manager?.name);
  push(manager?._id);
  return [...new Set(tokens)];
};

/**
 * Mongo filter: users who report to this manager (same company when set).
 */
const teamMemberFilter = (manager) => {
  const tokens = managerIdentityTokens(manager);
  if (!tokens.length) {
    return { _id: { $in: [] } };
  }

  const headMatch = {
    $or: tokens.flatMap((t) => {
      const rx = new RegExp(`^${escapeRegex(t)}$`, "i");
      return [
        { "official.reportingHead1": rx },
        { "official.reportingHead2": rx },
      ];
    }),
  };

  const and = [headMatch, { role: { $in: [EMPLOYEE, "Employee"] } }];

  const scope = companyFilter(manager);
  if (scope === false) {
    return { _id: { $in: [] } };
  }
  if (scope) and.push(scope);

  return { $and: and };
};

/** Load team member ObjectIds for a Reporting Manager */
const getTeamMemberIds = async (manager) => {
  const rows = await User.find(teamMemberFilter(manager)).select("_id").lean();
  return rows.map((r) => r._id);
};

/**
 * Error if actor cannot access this employee under team + company rules.
 * Super Admin / Admin / HR → company rules only.
 * Reporting Manager → must be on their team (or self).
 * Employee → self only (caller usually checks separately).
 */
const assertTeamOrCompanyEmployee = (actor, employee) => {
  if (!actor || !employee) return "Access denied";
  if (String(actor._id) === String(employee._id)) return null;

  if (hasGlobalCompanyAccess(actor)) return null;

  const role = normalizeRoleName(actor.role);
  if (isTeamScopedRole(role) || role === REPORTING_MANAGER) {
    const tokens = managerIdentityTokens(actor).map((t) => t.toLowerCase());
    const h1 = String(employee.official?.reportingHead1 || "")
      .trim()
      .toLowerCase();
    const h2 = String(employee.official?.reportingHead2 || "")
      .trim()
      .toLowerCase();
    const onTeam =
      (h1 && tokens.includes(h1)) || (h2 && tokens.includes(h2));
    if (!onTeam) {
      return "You can only manage employees on your team";
    }
    return assertSameCompanyEmployee(actor, employee);
  }

  return assertSameCompanyEmployee(actor, employee);
};

/**
 * List filter for admin tables.
 * Reporting Manager → team members only.
 * Others → companyFilter (or null for platform).
 */
const listScopeFilter = (actor) => {
  if (hasGlobalCompanyAccess(actor)) return null;

  const role = normalizeRoleName(actor.role);
  if (isTeamScopedRole(role) || role === REPORTING_MANAGER) {
    return teamMemberFilter(actor);
  }

  return companyFilter(actor);
};

module.exports = {
  managerIdentityTokens,
  teamMemberFilter,
  getTeamMemberIds,
  assertTeamOrCompanyEmployee,
  listScopeFilter,
  getAccessibleCompanies,
};
