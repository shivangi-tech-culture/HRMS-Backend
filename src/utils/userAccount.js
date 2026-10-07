/**
 * List helpers for Employee Management & Access & Control tables
 * (search, filters, pagination, row mapping).
 */
const { hasAllAccess } = require("../middleware/auth");
const {
  visibleRoleFilter,
  normalizeRoleName,
  isTeamScopedRole,
  REPORTING_MANAGER,
  EMPLOYEE,
} = require("../config/roles");
const {
  listScopeFilter,
  REPORTING_HEAD_POPULATE,
  headRef,
} = require("./teamScope");
const {
  companyFilter,
  companyRefs,
  COMPANY_POPULATE,
  findCompany,
} = require("./companyScope");
const { applyAnniversary } = require("./anniversary");
const { attachPlacement } = require("./companyShift");
const { getModel } = require("../models/Master");

/** Populate for list / export queries */
const LIST_POPULATE = [COMPANY_POPULATE];

/**
 * User document → API JSON: no password/contact; companies and reporting heads populated.
 * reportingHead1/2 become { _id, name, email, employeeCode } or null.
 */
const safeUser = async (doc) => {
  if (!doc) return null;
  if (doc.populate) {
    await doc.populate([...LIST_POPULATE, ...REPORTING_HEAD_POPULATE]);
  }
  applyAnniversary(doc);
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  delete obj.contact;
  if (obj.official) {
    obj.official.reportingHead1 = headRef(obj.official.reportingHead1);
    obj.official.reportingHead2 = headRef(obj.official.reportingHead2);
  }
  await attachPlacement(obj);
  return obj;
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exact = (value) =>
  new RegExp(`^${escapeRegex(String(value).trim())}$`, "i");

/**
 * Ignore empty / "All …" dropdown placeholders from the UI.
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

/** Branch / shift filter value (master _id, name or code) → Mongo condition on the master id */
const masterIdFilter = async (type, value) => {
  if (/^[a-fA-F0-9]{24}$/.test(value)) return value;
  const ids = await getModel(type)
    .find({ $or: [{ name: exact(value) }, { code: String(value).trim().toUpperCase() }] })
    .distinct("_id");
  return { $in: ids.length ? ids : [null] };
};

/**
 * Who may appear on GET /api/users (role hierarchy).
 * Prefer hierarchy.visibleRoleFilter; keep export name for callers.
 */
const visibleRolesForActor = (actor) => visibleRoleFilter(actor.role);

/**
 * Shared table search + filters + pagination.
 */
const buildListQuery = async (req, { forceRole, roleScope } = {}) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const skip = (page - 1) * limit;
  const and = [];

  if (!hasAllAccess(req.user)) {
    and.push({ _id: req.user._id });
  } else {
    const role = normalizeRoleName(req.user.role);
    // Reporting Manager → team only; others → company / all
    const scope =
      isTeamScopedRole(role) || role === REPORTING_MANAGER
        ? listScopeFilter(req.user)
        : companyFilter(req.user);

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

  const search = filterValue(req, "search", "q", "query", "keyword");
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    if (forceRole === EMPLOYEE || forceRole === "Employee") {
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
      and.push({
        $or: [
          { name: rx },
          { "official.officialEmail": rx },
          { "official.department": rx },
          { role: rx },
          { "official.employeeCode": rx },
        ],
      });
    }
  }

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

  const company = filterValue(req, "company", "companyId");
  if (company) {
    const doc = await findCompany(company);
    and.push(doc ? { "official.companyIds": doc._id } : { _id: null });
  }

  const managerId = filterValue(req, "managerId", "reportingHead");
  if (managerId) {
    if (!/^[a-fA-F0-9]{24}$/.test(managerId)) {
      return { error: { status: 400, message: "Invalid managerId" } };
    }
    and.push({
      $or: [
        { "official.reportingHead1": managerId },
        { "official.reportingHead2": managerId },
      ],
    });
  }

  const unassigned = filterValue(req, "unassigned") === "true";
  if (unassigned) {
    and.push({ "official.reportingHead1": null, "official.reportingHead2": null });
  }

  const branch = filterValue(req, "branch", "branchId");
  if (branch) and.push({ "official.branchId": await masterIdFilter("branch", branch) });

  const shift = filterValue(req, "shift", "shiftId");
  if (shift) and.push({ "official.shiftId": await masterIdFilter("shift", shift) });

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
      branch: branch || "",
      shift: shift || "",
      managerId: managerId || "",
      unassigned,
    },
  };
};

/** Access & Control table row — query must populate LIST_POPULATE */
const mapListRow = (row) => ({
  _id: row._id,
  name: row.name || "",
  email: row.official?.officialEmail || "",
  role: row.role || "",
  department: row.official?.department || "",
  lastLogin: row.lastLogin || null,
  status: row.status || "",
  companies: companyRefs(row),
  branch: row.official?.branchId?.name || "",
  shift: row.official?.shiftId?.name || "",
});

/** Employee Management table row — query must populate LIST_POPULATE */
const mapEmployeeListRow = (row) => ({
  _id: row._id,
  name: row.name || "",
  employeeCode: row.official?.employeeCode || "",
  gender: row.personal?.gender || "",
  designation: row.official?.designation || "",
  department: row.official?.department || "",
  companies: companyRefs(row),
  branch: row.official?.branchId?.name || "",
  shift: row.official?.shiftId?.name || "",
  status: row.status || "",
  email: row.official?.officialEmail || "",
  reportingHead1: headRef(row.official?.reportingHead1),
  reportingHead2: headRef(row.official?.reportingHead2),
});

const LIST_SELECT =
  "name role status lastLogin official.officialEmail official.employeeCode official.department official.designation official.companyIds official.branchId official.shiftId personal.gender";

module.exports = {
  safeUser,
  LIST_POPULATE,
  visibleRolesForActor,
  buildListQuery,
  mapListRow,
  mapEmployeeListRow,
  LIST_SELECT,
  isAllFilter,
  filterValue,
};
