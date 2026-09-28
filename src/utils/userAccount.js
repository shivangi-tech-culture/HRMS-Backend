/**
 * List helpers for Employee Management & Access & Control tables
 * (search, filters, pagination, row mapping).
 *
 * Access & Control UI: search, role, department, company, status
 * Employee UI: search (name/code), status, department, designation, gender
 */
const { hasAllAccess } = require("../middleware/auth");
const { companyFilter } = require("./companyScope");

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exact = (value) =>
  new RegExp(`^${escapeRegex(String(value).trim())}$`, "i");

/**
 * Ignore empty / "All …" dropdown placeholders from the UI.
 * e.g. "All roles", "All Status", "all", ""
 */
const isAllFilter = (value) => {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (!v) return true;
  if (v === "all") return true;
  if (v.startsWith("all ")) return true;
  return false;
};

/** Read query param; null if missing / "All …" */
const filterValue = (req, ...keys) => {
  for (const key of keys) {
    if (req.query[key] === undefined || req.query[key] === null) continue;
    if (isAllFilter(req.query[key])) continue;
    return String(req.query[key]).trim();
  }
  return null;
};

/**
 * Who may appear on GET /api/users (role hierarchy).
 * Global Admin → everyone
 * Super Admin  → all except Global Admin (same company)
 * HR / Manager → all except Global Admin + Super Admin (same company)
 */
const visibleRolesForActor = (actor) => {
  if (actor.role === "Global Admin") return null;
  if (actor.role === "Super Admin") {
    return { role: { $ne: "Global Admin" } };
  }
  return { role: { $nin: ["Global Admin", "Super Admin"] } };
};

/**
 * Shared table search + filters + pagination.
 *
 * Query (Access & Control):
 *   search|q, role, status, department, company|branch, page, limit
 *
 * Query (Employee Management):
 *   search|q (name, code, email), status, department, designation, gender,
 *   company|branch, page, limit
 */
const buildListQuery = (req, { forceRole, roleScope } = {}) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const skip = (page - 1) * limit;
  const and = [];

  if (!hasAllAccess(req.user)) {
    and.push({ _id: req.user._id });
  } else {
    const scope = companyFilter(req.user);
    if (scope === false) {
      return {
        error: {
          status: 403,
          message: "Your profile has no company — cannot list employees",
        },
      };
    }
    if (scope) and.push(scope);
  }

  if (forceRole) {
    and.push({ role: forceRole });
  } else if (roleScope) {
    and.push(roleScope);
  }

  // --- SEARCH (Access: name/email/dept/role | Employee: name/code/email) ---
  const search = filterValue(req, "search", "q", "query", "keyword");
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    if (forceRole === "Employee") {
      // Employee module: "Search name, code..."
      and.push({
        $or: [
          { name: rx },
          { "official.employeeCode": rx },
          { "official.officialEmail": rx },
          { "official.designation": rx },
          { "official.department": rx },
        ],
      });
    } else {
      // Access & Control: "Search..."
      and.push({
        $or: [
          { name: rx },
          { "official.officialEmail": rx },
          { "official.department": rx },
          { role: rx },
          { "official.company": rx },
          { "official.employeeCode": rx },
        ],
      });
    }
  }

  // --- FILTERS (skip "All roles" / "All Status" / …) ---
  const role = !forceRole ? filterValue(req, "role") : null;
  if (role) {
    if (roleScope?.role?.$ne && role === roleScope.role.$ne) {
      return { error: { status: 403, message: "You cannot list that role" } };
    }
    if (
      Array.isArray(roleScope?.role?.$nin) &&
      roleScope.role.$nin.includes(role)
    ) {
      return { error: { status: 403, message: "You cannot list that role" } };
    }
    and.push({ role: exact(role) });
  }

  const status = filterValue(req, "status");
  if (status) and.push({ status: exact(status) });

  const department = filterValue(req, "department");
  if (department) {
    and.push({ "official.department": exact(department) });
  }

  const designation = filterValue(req, "designation");
  if (designation) {
    and.push({ "official.designation": exact(designation) });
  }

  const gender = filterValue(req, "gender");
  if (gender) and.push({ "personal.gender": exact(gender) });

  const company = filterValue(req, "company", "branch");
  if (company) and.push({ "official.company": exact(company) });

  return {
    page,
    limit,
    skip,
    filter: and.length ? { $and: and } : {},
    applied: {
      search: search || "",
      role: role || "",
      status: status || "",
      department: department || "",
      designation: designation || "",
      gender: gender || "",
      company: company || "",
    },
  };
};

/** Access & Control table row */
const mapListRow = (row) => ({
  _id: row._id,
  name: row.name || "",
  email: row.official?.officialEmail || "",
  role: row.role || "",
  department: row.official?.department || "",
  lastLogin: row.lastLogin || null,
  status: row.status || "",
  company: row.official?.company || "",
});

/** Employee Management table row */
const mapEmployeeListRow = (row) => ({
  _id: row._id,
  name: row.name || "",
  employeeCode: row.official?.employeeCode || "",
  gender: row.personal?.gender || "",
  designation: row.official?.designation || "",
  department: row.official?.department || "",
  branch: row.official?.company || "",
  status: row.status || "",
  email: row.official?.officialEmail || "",
});

const LIST_SELECT =
  "name role status lastLogin official.officialEmail official.employeeCode official.department official.designation official.company official.shift personal.gender";

module.exports = {
  visibleRolesForActor,
  buildListQuery,
  mapListRow,
  mapEmployeeListRow,
  LIST_SELECT,
  isAllFilter,
  filterValue,
};
