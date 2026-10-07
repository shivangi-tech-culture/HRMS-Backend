/**
 * TEAM SCOPE — Reporting Manager sees only their direct reports
 *
 * employee.official.reportingHead1 | reportingHead2 = manager's User _id.
 * Assigned manually (POST /api/employees/assign-manager or /api/users/assign-manager).
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

const MANAGER_ROLES = [REPORTING_MANAGER, "Manager"];

/** Mongoose populate options for official.reportingHead1 / reportingHead2 */
const REPORTING_HEAD_POPULATE = ["reportingHead1", "reportingHead2"].map(
  (key) => ({
    path: `official.${key}`,
    select: "name official.officialEmail official.employeeCode",
  })
);

/** Populated head → { _id, name, email, employeeCode }; raw id → { _id }; empty → null */
const headRef = (head) => {
  if (!head) return null;
  if (head.name === undefined) return { _id: head._id || head };
  return {
    _id: head._id,
    name: head.name || "",
    email: head.official?.officialEmail || "",
    employeeCode: head.official?.employeeCode || "",
  };
};

/** String id of a head whether raw ObjectId or populated doc */
const headId = (head) => (head ? String(head._id || head) : "");

/**
 * official.reportingHead1 / reportingHead2 from a create/update body.
 * "" → null. Each id must be an active Reporting Manager; both heads cannot be the same.
 * Mutates official in place. Returns error message or null.
 */
const validateReportingHeads = async (official) => {
  if (!official) return null;
  const keys = ["reportingHead1", "reportingHead2"].filter(
    (k) => official[k] !== undefined
  );
  for (const key of keys) {
    if (official[key] === "") official[key] = null;
    if (!official[key]) continue;
    const mgr = await User.findById(official[key]).select("role status").lean();
    if (!mgr || !MANAGER_ROLES.includes(normalizeRoleName(mgr.role))) {
      return `official.${key} must be a Reporting Manager _id`;
    }
    if (mgr.status !== "Active") {
      return `official.${key} — Reporting Manager is inactive`;
    }
  }
  if (
    official.reportingHead1 &&
    String(official.reportingHead1) === String(official.reportingHead2)
  ) {
    return "reportingHead1 and reportingHead2 cannot be the same manager";
  }
  return null;
};

/** Mongo filter: employees whose reportingHead1 or reportingHead2 is this manager. */
const teamMemberFilter = (manager) => {
  if (!manager?._id) return { _id: { $in: [] } };
  return {
    role: { $in: [EMPLOYEE, "Employee"] },
    $or: [
      { "official.reportingHead1": manager._id },
      { "official.reportingHead2": manager._id },
    ],
  };
};

/** True when employee reports to managerId (either head). */
const reportsTo = (employee, managerId) => {
  const id = String(managerId || "");
  if (!id) return false;
  return (
    headId(employee?.official?.reportingHead1) === id ||
    headId(employee?.official?.reportingHead2) === id
  );
};

/** Load team member ObjectIds for a Reporting Manager */
const getTeamMemberIds = async (manager) => {
  const rows = await User.find(teamMemberFilter(manager)).select("_id").lean();
  return rows.map((r) => r._id);
};

/**
 * Error if actor cannot access this employee under team + company rules.
 * Super Admin / Admin / HR → company rules only.
 * Reporting Manager → must be on their team (or self). Assignment decides, not company.
 * Employee → self only (caller usually checks separately).
 */
const assertTeamOrCompanyEmployee = (actor, employee) => {
  if (!actor || !employee) return "Access denied";
  if (String(actor._id) === String(employee._id)) return null;

  if (hasGlobalCompanyAccess(actor)) return null;

  const role = normalizeRoleName(actor.role);
  if (isTeamScopedRole(role) || role === REPORTING_MANAGER) {
    return reportsTo(employee, actor._id)
      ? null
      : "You can only manage employees on your team";
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
  MANAGER_ROLES,
  REPORTING_HEAD_POPULATE,
  headRef,
  headId,
  validateReportingHeads,
  teamMemberFilter,
  reportsTo,
  getTeamMemberIds,
  assertTeamOrCompanyEmployee,
  listScopeFilter,
  getAccessibleCompanies,
};
