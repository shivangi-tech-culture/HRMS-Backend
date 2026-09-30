/**
 * HIERARCHY MODULE — Organization tree (like Manager Hierarchy UI)
 *
 * Super Admin
 *   └── Admin(s)
 *         ├── HR Manager(s)  [multi-company]
 *         └── Reporting Manager(s)
 *               └── Employee team (reportingHead1 / reportingHead2)
 *
 * Routes: /api/hierarchy
 */
const User = require("../models/User");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  SYSTEM_ROLES,
  ROLE_DESCRIPTIONS,
  normalizeRoleName,
  hasGlobalCompanyRole,
} = require("../config/roles");
const {
  managerIdentityTokens,
  teamMemberFilter,
} = require("../utils/teamScope");

const USER_SELECT =
  "name role status avatar official.officialEmail official.employeeCode official.company official.companies official.department official.designation official.reportingHead1 official.reportingHead2";

const toCard = (u) => ({
  id: u._id,
  name: u.name || "",
  role: normalizeRoleName(u.role),
  email: u.official?.officialEmail || "",
  employeeCode: u.official?.employeeCode || "",
  company: u.official?.company || "",
  companies: Array.isArray(u.official?.companies)
    ? u.official.companies
    : u.official?.company
      ? [u.official.company]
      : [],
  department: u.official?.department || "",
  designation: u.official?.designation || "",
  status: u.status || "Active",
  avatar: u.avatar || null,
  reportingHead1: u.official?.reportingHead1 || "",
  reportingHead2: u.official?.reportingHead2 || "",
});

/**
 * GET /api/hierarchy
 * Ladder overview + counts (easy to understand)
 */
const getOverview = async (req, res) => {
  try {
    const levels = [];
    for (const role of SYSTEM_ROLES) {
      const users = await User.find({ role })
        .select(USER_SELECT)
        .sort({ name: 1 })
        .lean();
      levels.push({
        role,
        description: ROLE_DESCRIPTIONS[role] || "",
        count: users.length,
        users: users.map(toCard),
      });
    }

    return res.json({
      message: "Role hierarchy overview",
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

/**
 * GET /api/hierarchy/tree
 * Full org tree for UI (Tree View / Expand all)
 */
const getTree = async (req, res) => {
  try {
    const [
      superAdmins,
      admins,
      hrs,
      managers,
      employees,
    ] = await Promise.all([
      User.find({ role: SUPER_ADMIN }).select(USER_SELECT).sort({ name: 1 }).lean(),
      User.find({ role: ADMIN }).select(USER_SELECT).sort({ name: 1 }).lean(),
      User.find({ role: HR }).select(USER_SELECT).sort({ name: 1 }).lean(),
      User.find({ role: REPORTING_MANAGER })
        .select(USER_SELECT)
        .sort({ name: 1 })
        .lean(),
      User.find({ role: EMPLOYEE }).select(USER_SELECT).sort({ name: 1 }).lean(),
    ]);

    // Attach team under each Reporting Manager
    const managerNodes = [];
    for (const mgr of managers) {
      const team = employees.filter((emp) => {
        const tokens = managerIdentityTokens(mgr).map((t) => t.toLowerCase());
        const h1 = String(emp.official?.reportingHead1 || "")
          .trim()
          .toLowerCase();
        const h2 = String(emp.official?.reportingHead2 || "")
          .trim()
          .toLowerCase();
        return (h1 && tokens.includes(h1)) || (h2 && tokens.includes(h2));
      });

      managerNodes.push({
        ...toCard(mgr),
        teamCount: team.length,
        children: team.map(toCard),
      });
    }

    const unassignedEmployees = employees.filter((emp) => {
      const h1 = String(emp.official?.reportingHead1 || "").trim();
      const h2 = String(emp.official?.reportingHead2 || "").trim();
      if (!h1 && !h2) return true;
      return !managerNodes.some((m) =>
        m.children.some((c) => String(c.id) === String(emp._id))
      );
    });

    const tree = {
      role: SUPER_ADMIN,
      label: "Super Admin",
      count: superAdmins.length,
      users: superAdmins.map(toCard),
      children: [
        {
          role: ADMIN,
          label: "Admins",
          count: admins.length,
          users: admins.map(toCard),
          children: [
            {
              role: HR,
              label: "HR Managers",
              count: hrs.length,
              users: hrs.map(toCard),
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
      note: "Reporting Manager → employees linked via official.reportingHead1 / reportingHead2",
      tree,
      unassignedEmployees: unassignedEmployees.map(toCard),
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
    const managers = await User.find({
      role: { $in: [REPORTING_MANAGER, "Manager"] },
      status: "Active",
    })
      .select(USER_SELECT)
      .sort({ name: 1 })
      .lean();

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
    const mgr = await User.findById(req.params.id).select(USER_SELECT);
    if (!mgr) {
      return res.status(404).json({ message: "Reporting Manager not found" });
    }

    const role = normalizeRoleName(mgr.role);
    if (role !== REPORTING_MANAGER && role !== "Manager") {
      return res.status(400).json({
        message: "User is not a Reporting Manager",
      });
    }

    // Scope: Super/Admin see any; HR same company; RM only self
    const actorRole = normalizeRoleName(req.user.role);
    if (
      !hasGlobalCompanyRole(actorRole) &&
      actorRole !== HR &&
      String(req.user._id) !== String(mgr._id)
    ) {
      if (actorRole === REPORTING_MANAGER) {
        return res.status(403).json({ message: "You can only view your own team" });
      }
    }

    const team = await User.find(teamMemberFilter(mgr))
      .select(USER_SELECT)
      .sort({ name: 1 })
      .lean();

    return res.json({
      message: "Reporting Manager team",
      manager: toCard(mgr),
      teamCount: team.length,
      team: team.map(toCard),
      steps: [
        { step: 1, label: "Select Reporting Manager", selected: toCard(mgr) },
        {
          step: 2,
          label: `Team (${team.length})`,
          members: team.map(toCard),
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
      User.find({ role: SUPER_ADMIN }).select(USER_SELECT).lean(),
      User.find({ role: ADMIN }).select(USER_SELECT).sort({ name: 1 }).lean(),
      User.find({ role: HR }).select(USER_SELECT).sort({ name: 1 }).lean(),
      User.find({ role: REPORTING_MANAGER })
        .select(USER_SELECT)
        .sort({ name: 1 })
        .lean(),
    ]);

    return res.json({
      message: "Super Admin hierarchy",
      root: {
        role: SUPER_ADMIN,
        users: superAdmins.map(toCard),
      },
      branches: [
        {
          role: ADMIN,
          label: "Admins",
          count: admins.length,
          users: admins.map(toCard),
        },
        {
          role: HR,
          label: "HR Managers (multi-company)",
          count: hrs.length,
          users: hrs.map(toCard),
        },
        {
          role: REPORTING_MANAGER,
          label: "Reporting Managers (team)",
          count: managers.length,
          users: managers.map(toCard),
        },
      ],
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
};
