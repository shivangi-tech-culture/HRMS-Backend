/**
 * HIERARCHY MODULE — one API: GET /api/hierarchy
 *
 * Super Admin
 *   └── Admin(s)
 *         └── HR Manager(s)
 *               └── Reporting Manager(s)
 *                     └── Employee team (reportingHead1 / reportingHead2 = manager _id)
 *
 * Response `tree` is nested: each role node has users[] + children[] (next role);
 * every Reporting Manager user has children[] = their employees.
 *
 * Super Admin / Admin / HR → whole tree (optional companyId; HR = own companies).
 * Reporting Manager        → tree rooted at self (self + team).
 * Assign / remove manager lives on POST /api/employees/assign-manager and POST /api/users/assign-manager.
 */
const User = require("../models/User");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  SYSTEM_ROLES,
  normalizeRoleName,
  isTeamScopedRole,
} = require("../config/roles");
const {
  MANAGER_ROLES,
  REPORTING_HEAD_POPULATE,
  headRef,
  headId,
  teamMemberFilter,
  reportsTo,
} = require("../utils/teamScope");
const {
  COMPANY_POPULATE,
  companyRefs,
  hasGlobalCompanyAccess,
  managementCompanyIds,
  findCompany,
} = require("../utils/companyScope");
const { filterValue } = require("../utils/userAccount");

const USER_SELECT =
  "name role status avatar official.officialEmail official.employeeCode official.companyIds official.department official.designation official.reportingHead1 official.reportingHead2";

/** User.find with the card fields + populated companies and reporting heads */
const findCards = (filter) =>
  User.find(filter)
    .select(USER_SELECT)
    .populate([COMPANY_POPULATE, ...REPORTING_HEAD_POPULATE])
    .sort({ name: 1 })
    .lean();

const toCard = (u) => ({
  id: u._id,
  name: u.name || "",
  role: normalizeRoleName(u.role),
  email: u.official?.officialEmail || "",
  employeeCode: u.official?.employeeCode || "",
  companies: companyRefs(u),
  department: u.official?.department || "",
  designation: u.official?.designation || "",
  status: u.status || "Active",
  avatar: u.avatar || null,
  reportingHead1: headRef(u.official?.reportingHead1),
  reportingHead2: headRef(u.official?.reportingHead2),
});

/** One tree node per role: its users + the next role down in children[] */
const roleNode = (level, role, label, users, children = []) => ({
  level,
  role,
  label,
  count: users.length,
  users,
  children,
});

/** Manager card whose children[] = their team; reportingLevel 1 = primary, 2 = secondary head */
const managerNode = (mgr, employees) => {
  const team = employees.filter((emp) => reportsTo(emp, mgr._id));
  return {
    ...toCard(mgr),
    teamCount: team.length,
    children: team.map((emp) => ({
      ...toCard(emp),
      reportingLevel:
        String(headId(emp.official?.reportingHead1)) === String(mgr._id) ? 1 : 2,
    })),
  };
};

/** Reporting Manager → tree rooted at themselves with their team */
const myHierarchy = async (req, res) => {
  const [[me], team] = await Promise.all([
    findCards({ _id: req.user._id }),
    findCards(teamMemberFilter(req.user)),
  ]);
  return res.json({
    message: "My hierarchy",
    scope: "team",
    company: null,
    ladder: [REPORTING_MANAGER, EMPLOYEE],
    totals: { reportingManager: 1, employee: team.length, unassignedEmployees: 0 },
    tree: roleNode(1, REPORTING_MANAGER, "Me", [managerNode(me, team)]),
    unassignedEmployees: [],
  });
};

/**
 * GET /api/hierarchy?companyId=&status=
 * tree: Super Admin → Admins → HR Managers → Reporting Managers (each manager's children = team)
 */
const getHierarchy = async (req, res) => {
  try {
    if (isTeamScopedRole(req.user.role)) return await myHierarchy(req, res);

    const mine = hasGlobalCompanyAccess(req.user) ? null : managementCompanyIds(req.user);
    const companyValue = filterValue(req, "companyId", "company");
    let company = null;
    let companyMatch = mine ? { "official.companyIds": { $in: mine } } : {};
    if (companyValue) {
      company = await findCompany(companyValue);
      if (!company) {
        return res.status(404).json({ message: `Company not found: ${companyValue}` });
      }
      if (mine && !mine.includes(String(company._id))) {
        return res.status(403).json({ message: "This company is not assigned to you" });
      }
      companyMatch = { "official.companyIds": company._id };
    }

    const status = filterValue(req, "status");
    const base = status ? { status } : {};
    const inCompany = { ...base, ...companyMatch };

    const [superAdmins, admins, hrs, managers, employees] = await Promise.all([
      findCards({ ...base, role: SUPER_ADMIN }),
      findCards({ ...base, role: ADMIN }),
      findCards({ ...inCompany, role: HR }),
      findCards({ ...inCompany, role: { $in: MANAGER_ROLES } }),
      findCards({ ...inCompany, role: EMPLOYEE }),
    ]);

    const unassigned = employees.filter(
      (emp) =>
        !headId(emp.official?.reportingHead1) &&
        !headId(emp.official?.reportingHead2)
    );

    return res.json({
      message: "Organization hierarchy",
      scope: "organization",
      company: company ? { _id: company._id, companyName: company.companyName } : null,
      ladder: SYSTEM_ROLES,
      totals: {
        superAdmin: superAdmins.length,
        admin: admins.length,
        hrManager: hrs.length,
        reportingManager: managers.length,
        employee: employees.length,
        unassignedEmployees: unassigned.length,
      },
      tree: roleNode(1, SUPER_ADMIN, "Super Admin", superAdmins.map(toCard), [
        roleNode(2, ADMIN, "Admins", admins.map(toCard), [
          roleNode(3, HR, "HR Managers", hrs.map(toCard), [
            roleNode(
              4,
              REPORTING_MANAGER,
              "Reporting Managers",
              managers.map((mgr) => managerNode(mgr, employees))
            ),
          ]),
        ]),
      ]),
      unassignedEmployees: unassigned.map(toCard),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getHierarchy };
