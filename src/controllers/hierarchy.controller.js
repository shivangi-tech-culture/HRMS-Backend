/**
 * HIERARCHY MODULE — Organization tree (like Manager Hierarchy UI)
 *
 * Super Admin
 *   └── Admin(s)
 *         ├── HR Manager(s)  [multi-company]
 *         └── Reporting Manager(s)
 *               └── Employee team (reportingHead1 / reportingHead2 = manager _id)
 *
 * Team membership is manual: POST /assign, POST /unassign (bulk).
 *
 * Routes: /api/hierarchy
 */
const User = require("../models/User");
const { logEmployeeActivity } = require("../utils/activityLog");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  SYSTEM_ROLES,
  ROLE_DESCRIPTIONS,
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
  assertTeamOrCompanyEmployee,
} = require("../utils/teamScope");
const {
  COMPANY_POPULATE,
  companyRefs,
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");

const USER_SELECT =
  "name role status avatar official.officialEmail official.employeeCode official.companyIds official.department official.designation official.reportingHead1 official.reportingHead2";

/** User.find with the card fields + populated companies and reporting heads */
const findCards = (filter) =>
  User.find(filter)
    .select(USER_SELECT)
    .populate([COMPANY_POPULATE, ...REPORTING_HEAD_POPULATE]);

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

/**
 * "team" → Reporting Manager: own hierarchy only (self + direct reports).
 * "organization" → Super Admin / Admin / HR (and custom admin roles): everyone.
 */
const viewScope = (actor) =>
  isTeamScopedRole(actor.role) ? "team" : "organization";

/** Mongo filter limiting a query to the actor's visible hierarchy (null = no limit) */
const visibleFilter = (actor) =>
  viewScope(actor) === "team"
    ? { $or: [{ _id: actor._id }, teamMemberFilter(actor)] }
    : null;

/**
 * GET /api/hierarchy
 * Ladder overview + counts (easy to understand)
 */
const getOverview = async (req, res) => {
  try {
    const scope = visibleFilter(req.user);
    const levels = [];
    for (const role of SYSTEM_ROLES) {
      const filter = scope ? { $and: [{ role }, scope] } : { role };
      const users = await findCards(filter).sort({ name: 1 }).lean();
      levels.push({
        role,
        description: ROLE_DESCRIPTIONS[role] || "",
        count: users.length,
        users: users.map(toCard),
      });
    }

    return res.json({
      message: "Role hierarchy overview",
      scope: viewScope(req.user),
      ladder: [
        SUPER_ADMIN,
        ADMIN,
        HR,
        REPORTING_MANAGER,
        EMPLOYEE,
      ],
      levels,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Reporting Manager tree: themselves as root, their team as children. */
const getMyTeamTree = async (req, res) => {
  const [me, team] = await Promise.all([
    findCards({ _id: req.user._id }).lean(),
    findCards(teamMemberFilter(req.user)).sort({ name: 1 }).lean(),
  ]);
  const node = {
    ...toCard(me[0]),
    teamCount: team.length,
    children: team.map(toCard),
  };
  return res.json({
    message: "My hierarchy",
    scope: "team",
    tree: {
      role: REPORTING_MANAGER,
      label: "My Team",
      count: 1,
      users: [node],
      children: [node],
    },
    unassignedEmployees: [],
    totals: { reportingManager: 1, employee: team.length },
  });
};

/**
 * GET /api/hierarchy/tree
 * Full org tree for UI (Tree View / Expand all). Reporting Manager → own team tree.
 */
const getTree = async (req, res) => {
  try {
    if (viewScope(req.user) === "team") return await getMyTeamTree(req, res);

    const [
      superAdmins,
      admins,
      hrs,
      managers,
      employees,
    ] = await Promise.all([
      findCards({ role: SUPER_ADMIN }).sort({ name: 1 }).lean(),
      findCards({ role: ADMIN }).sort({ name: 1 }).lean(),
      findCards({ role: HR }).sort({ name: 1 }).lean(),
      findCards({ role: REPORTING_MANAGER }).sort({ name: 1 }).lean(),
      findCards({ role: EMPLOYEE }).sort({ name: 1 }).lean(),
    ]);

    const card = toCard;

    // Attach team under each Reporting Manager
    const managerNodes = [];
    for (const mgr of managers) {
      const team = employees.filter((emp) => reportsTo(emp, mgr._id));

      managerNodes.push({
        ...card(mgr),
        teamCount: team.length,
        children: team.map(card),
      });
    }

    const unassignedEmployees = employees.filter(
      (emp) => !managers.some((mgr) => reportsTo(emp, mgr._id))
    );

    const tree = {
      role: SUPER_ADMIN,
      label: "Super Admin",
      count: superAdmins.length,
      users: superAdmins.map(card),
      children: [
        {
          role: ADMIN,
          label: "Admins",
          count: admins.length,
          users: admins.map(card),
          children: [
            {
              role: HR,
              label: "HR Managers",
              count: hrs.length,
              users: hrs.map(card),
              children: [],
            },
            {
              role: REPORTING_MANAGER,
              label: "Reporting Managers",
              count: managers.length,
              users: managerNodes,
              children: managerNodes,
            },
          ],
        },
      ],
    };

    return res.json({
      message: "Organization tree",
      scope: "organization",
      note: "Reporting Manager → employees whose official.reportingHead1 / reportingHead2 is the manager _id (assigned via POST /api/hierarchy/assign)",
      tree,
      unassignedEmployees: unassignedEmployees.map(card),
      totals: {
        superAdmin: superAdmins.length,
        admin: admins.length,
        hr: hrs.length,
        reportingManager: managers.length,
        employee: employees.length,
        unassignedEmployees: unassignedEmployees.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/hierarchy/reporting-managers
 * Manager Hierarchy list (Managers strip + team counts) — like ezwealth UI top row
 */
const listReportingManagers = async (req, res) => {
  try {
    const filter = { role: { $in: MANAGER_ROLES }, status: "Active" };
    if (viewScope(req.user) === "team") filter._id = req.user._id;
    const managers = await findCards(filter).sort({ name: 1 }).lean();

    const rows = [];
    for (const mgr of managers) {
      const teamCount = await User.countDocuments(teamMemberFilter(mgr));
      rows.push({
        ...toCard(mgr),
        teamCount,
      });
    }

    return res.json({
      message: "Reporting Managers",
      scope: viewScope(req.user),
      count: rows.length,
      label: `Reporting Managers (${rows.length})`,
      managers: rows,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/hierarchy/reporting-managers/:id
 * One manager selected → Step 2 team list (ezwealth style)
 */
const getReportingManagerTeam = async (req, res) => {
  try {
    const mgr = await User.findById(req.params.id)
      .select(USER_SELECT)
      .populate([COMPANY_POPULATE, ...REPORTING_HEAD_POPULATE]);
    if (!mgr) {
      return res.status(404).json({ message: "Reporting Manager not found" });
    }

    if (!MANAGER_ROLES.includes(normalizeRoleName(mgr.role))) {
      return res.status(400).json({
        message: "User is not a Reporting Manager",
      });
    }

    if (
      viewScope(req.user) === "team" &&
      String(req.user._id) !== String(mgr._id)
    ) {
      return res.status(403).json({ message: "You can only view your own team" });
    }

    const team = await findCards(teamMemberFilter(mgr))
      .sort({ name: 1 })
      .lean();

    const card = toCard;

    return res.json({
      message: "Reporting Manager team",
      manager: card(mgr),
      teamCount: team.length,
      team: team.map(card),
      steps: [
        { step: 1, label: "Select Reporting Manager", selected: card(mgr) },
        {
          step: 2,
          label: `Team (${team.length})`,
          members: team.map(card),
        },
      ],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/hierarchy/super-admin
 * Super Admin view — who sits under the top
 */
const getSuperAdminView = async (req, res) => {
  try {
    const [superAdmins, admins, hrs, managers] = await Promise.all([
      findCards({ role: SUPER_ADMIN }).lean(),
      findCards({ role: ADMIN }).sort({ name: 1 }).lean(),
      findCards({ role: HR }).sort({ name: 1 }).lean(),
      findCards({ role: REPORTING_MANAGER }).sort({ name: 1 }).lean(),
    ]);

    const card = toCard;

    return res.json({
      message: "Super Admin hierarchy",
      root: {
        role: SUPER_ADMIN,
        users: superAdmins.map(card),
      },
      branches: [
        {
          role: ADMIN,
          label: "Admins",
          count: admins.length,
          users: admins.map(card),
        },
        {
          role: HR,
          label: "HR Managers (multi-company)",
          count: hrs.length,
          users: hrs.map(card),
        },
        {
          role: REPORTING_MANAGER,
          label: "Reporting Managers (team)",
          count: managers.length,
          users: managers.map(card),
        },
      ],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Load employees by id and collect per-employee errors (all-or-nothing bulk).
 * Returns { employees } or { status, body }.
 */
const loadAssignableEmployees = async (actor, employeeIds, extraCheck) => {
  const ids = [...new Set(employeeIds.map(String))];
  const employees = await User.find({ _id: { $in: ids } }).select(
    "name role official.officialEmail official.employeeCode official.department official.designation official.companyIds official.reportingHead1 official.reportingHead2"
  );

  const found = new Set(employees.map((e) => String(e._id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    return {
      status: 404,
      body: { message: "Employee(s) not found", employeeIds: missing },
    };
  }

  const errors = [];
  for (const emp of employees) {
    let message = null;
    if (normalizeRoleName(emp.role) !== EMPLOYEE) {
      message = `Only Employee role can have a reporting manager (role: ${emp.role})`;
    } else if (!hasGlobalCompanyAccess(actor)) {
      message = assertTeamOrCompanyEmployee(actor, emp);
    }
    if (!message && extraCheck) message = extraCheck(emp);
    if (message) errors.push({ employeeId: emp._id, name: emp.name, message });
  }
  if (errors.length) {
    return {
      status: 400,
      body: { message: "Nothing was changed — fix these employees", errors },
    };
  }

  return { ids, employees };
};

const logHeadChange = (actor, employees, summary, changes) =>
  Promise.all(
    employees.map((employee) =>
      logEmployeeActivity({
        actor,
        employee,
        action: "update",
        section: "official",
        summary: `${summary} — ${employee.name}`,
        changes,
      })
    )
  );

/**
 * POST /api/hierarchy/assign
 * Body: { managerId, employeeIds: [...], level?: 1 | 2 }
 * Manual bulk assignment: official.reportingHead{level} = managerId for every employee.
 * Company is not used to pick or restrict the manager.
 */
const assignEmployees = async (req, res) => {
  try {
    const { managerId, employeeIds } = req.body;
    const level = Number(req.body.level || 1);
    const field = `reportingHead${level}`;
    const otherField = `reportingHead${level === 1 ? 2 : 1}`;

    const manager = await User.findById(managerId).select(
      "name role status official.officialEmail official.employeeCode"
    );
    if (!manager || !MANAGER_ROLES.includes(normalizeRoleName(manager.role))) {
      return res
        .status(400)
        .json({ message: "managerId must be a Reporting Manager" });
    }
    if (manager.status !== "Active") {
      return res.status(400).json({ message: "Reporting Manager is inactive" });
    }

    const loaded = await loadAssignableEmployees(
      req.user,
      employeeIds,
      (emp) =>
        headId(emp.official?.[otherField]) === String(manager._id)
          ? `${manager.name} is already ${otherField} — same manager cannot be both heads`
          : null
    );
    if (loaded.status) return res.status(loaded.status).json(loaded.body);

    await User.updateMany(
      { _id: { $in: loaded.ids } },
      { $set: { [`official.${field}`]: manager._id } }
    );
    await logHeadChange(
      req.user,
      loaded.employees,
      `${req.user.name} set ${field} = ${manager.name}`,
      [`official.${field}`]
    );

    const employees = await findCards({ _id: { $in: loaded.ids } })
      .sort({ name: 1 })
      .lean();
    return res.json({
      message: `${employees.length} employee(s) assigned to ${manager.name} as ${field}`,
      level,
      manager: headRef(manager),
      count: employees.length,
      employees: employees.map(toCard),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/hierarchy/unassign
 * Body: { employeeIds: [...], managerId?, level?: 1 | 2 }
 * managerId → clear only heads pointing to that manager (remove from their team).
 * level     → clear that head. Neither → clear both heads.
 */
const unassignEmployees = async (req, res) => {
  try {
    const { employeeIds, managerId } = req.body;
    const level = req.body.level ? Number(req.body.level) : null;

    const loaded = await loadAssignableEmployees(req.user, employeeIds);
    if (loaded.status) return res.status(loaded.status).json(loaded.body);

    const fields = level ? [`reportingHead${level}`] : ["reportingHead1", "reportingHead2"];
    for (const field of fields) {
      const filter = { _id: { $in: loaded.ids } };
      if (managerId) filter[`official.${field}`] = managerId;
      await User.updateMany(filter, { $set: { [`official.${field}`]: null } });
    }
    await logHeadChange(
      req.user,
      loaded.employees,
      `${req.user.name} cleared ${fields.join(" / ")}`,
      fields.map((f) => `official.${f}`)
    );

    const employees = await findCards({ _id: { $in: loaded.ids } })
      .sort({ name: 1 })
      .lean();
    return res.json({
      message: `Reporting head removed for ${employees.length} employee(s)`,
      count: employees.length,
      employees: employees.map(toCard),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getOverview,
  getTree,
  listReportingManagers,
  getReportingManagerTeam,
  getSuperAdminView,
  assignEmployees,
  unassignEmployees,
};
