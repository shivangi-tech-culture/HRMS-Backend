/**
 * Permissions catalog
 *
 * Single source of truth for Admin and ESS menus.
 * Shape matches Role.permissions in the database:
 *
 *   {
 *     module: "Dashboard",
 *     heading: "Overview",          // label only (can be "" for ESS)
 *     subModules: [
 *       { name: "Attendance Summary", actions: ["view", ...] }
 *     ]
 *   }
 *
 * Super Admin / HR Manager / Manager → ADMIN_TREE
 * Employee → ESS_TREE
 */

const ACTIONS = [
  "view", "create", "edit", "delete", "approve", "reject",
  "download", "export", "import", "upload", "print", "email", "share", "cancel", "assign",
];

// short action sets
const V = ["view"];
const VE = ["view", "export", "download", "print"];
const VC = ["view", "create"];
const VEd = ["view", "edit"];
const VCC = ["view", "create", "cancel"];
const CRUD = ["view", "create", "edit", "delete", "export", "import", "upload", "download"];
const LIST = ["view", "edit", "delete", "export", "import", "upload", "download", "email"];
const ATT = ["view", "create", "edit", "export", "import", "upload", "download", "print"];

// =========================================================
// ADMIN — Super Admin / HR Manager / Manager (same)
// =========================================================
const ADMIN_TREE = [
  // Dashboard
  {
    module: "Dashboard",
    heading: "Overview",
    subModules: [
      { name: "Attendance Summary", actions: VE },
      { name: "Leave Summary", actions: VE },
      { name: "Payroll Summary", actions: VE },
      { name: "Employee Statistics", actions: VE },
    ],
  },

  // Employee (HR) — one object only
  {
    module: "Employee",
    heading: "Employee Management",
    subModules: [
      {
        name: "Employee",
        actions: [
          "view", "create", "edit", "delete",
          "export", "import", "upload", "download", "email",
        ],
      },
    ],
  },

  // Attendance
  {
    module: "Attendance",
    heading: "Attendance & Time",
    subModules: [
      { name: "Daily Attendance", actions: ATT },
      { name: "Attendance Calendar", actions: V },
      {
        name: "Attendance Regularization",
        actions: ["view", "create", "approve", "reject", "cancel"],
      },
      { name: "Late & Early Departures", actions: VE },
      {
        name: "Overtime",
        actions: ["view", "create", "edit", "approve", "reject", "export", "download", "print"],
      },
      { name: "Attendance Reports", actions: VE },
    ],
  },

  // Break
  {
    module: "Break",
    heading: "Break Management",
    subModules: [
      {
        name: "Live Break Status",
        actions: ["view", "create", "edit", "export", "download"],
      },
      { name: "Break History", actions: VE },
      { name: "Break Summary", actions: VE },
      { name: "Break Policy", actions: ["view", "create", "edit", "delete"] },
    ],
  },

  // Leave
  {
    module: "Leave",
    heading: "Leave Management",
    subModules: [
      {
        name: "Leave Requests",
        actions: [
          "view", "create", "approve", "reject", "cancel",
          "export", "download", "upload",
        ],
      },
      { name: "Leave Types", actions: ["view", "create", "edit", "delete"] },
      { name: "Leave Balances", actions: VEd },
      { name: "Leave Calendar", actions: V },
      { name: "Leave Policies", actions: ["view", "create", "edit", "delete"] },
      { name: "Leave History", actions: VE },
    ],
  },

  // Payroll — heading label only, not a submodule
  {
    module: "Payroll",
    heading: "Payroll & Compensation",
    subModules: [
      { name: "Salary Structure", actions: ["view", "create", "edit", "delete"] },
      {
        name: "Payroll Processing",
        actions: [
          "view", "create", "edit", "approve", "reject",
          "export", "download", "print",
        ],
      },
      {
        name: "Salary Adjustments",
        actions: ["view", "create", "edit", "delete", "export", "download"],
      },
      { name: "Deductions", actions: ["view", "create", "edit", "delete"] },
      { name: "Payslips", actions: ["view", "download", "export", "print"] },
      { name: "Payroll History", actions: VE },
    ],
  },

  // Approvals
  {
    module: "Approvals",
    heading: "Approvals",
    subModules: [
      {
        name: "Pending Requests",
        actions: ["view", "approve", "reject", "export", "upload", "print"],
      },
      {
        name: "WFH Requests",
        actions: ["view", "approve", "reject", "create", "cancel"],
      },
      {
        name: "Permission Requests",
        actions: ["view", "approve", "reject", "create", "cancel"],
      },
      { name: "Request History", actions: ["view", "download", "export"] },
    ],
  },

  // Organization
  {
    module: "Organization",
    heading: "Organization",
    subModules: [
      { name: "Departments", actions: CRUD },
      { name: "Designations", actions: CRUD },
      { name: "Teams", actions: ["view", "create", "edit", "delete", "assign"] },
      { name: "Team Chat", actions: ["view", "create", "share"] },
      { name: "Mail", actions: ["view", "create", "email"] },
      { name: "Branches / Locations", actions: CRUD },
      { name: "Reporting Structure", actions: ["view", "edit", "assign"] },
    ],
  },

  // Work
  {
    module: "Work",
    heading: "Work Schedule",
    subModules: [
      { name: "Shift Management", actions: ["view", "create", "edit", "delete"] },
      {
        name: "Shift Assignments",
        actions: ["view", "create", "edit", "delete", "assign"],
      },
      { name: "Work Timings", actions: ["view", "create", "edit", "delete"] },
      { name: "Weekly Off", actions: ["view", "create", "edit", "delete"] },
      { name: "Holiday Calendar", actions: ["view", "create", "edit", "delete"] },
    ],
  },

  // Reports
  {
    module: "Reports",
    heading: "Reports & Analytics",
    subModules: [
      { name: "Employee Reports", actions: VE },
      { name: "Attendance Reports", actions: VE },
      { name: "Leave Reports", actions: VE },
      { name: "Break Reports", actions: VE },
      { name: "Overtime Reports", actions: VE },
      { name: "Payroll Reports", actions: VE },
    ],
  },

  // Communication
  {
    module: "Communication",
    heading: "Communication",
    subModules: [
      {
        name: "Announcements",
        actions: ["view", "create", "edit", "delete", "share", "download"],
      },
      { name: "Notifications", actions: V },
      {
        name: "Company Circulars",
        actions: ["view", "create", "edit", "delete", "share"],
      },
    ],
  },

  // Administration
  {
    module: "Administration",
    heading: "Administration",
    subModules: [
      { name: "Access & Control", actions: LIST },
      {
        name: "Roles & Permissions",
        actions: ["view", "create", "edit", "delete", "export"],
      },
      { name: "System Configuration", actions: VEd },
    ],
  },
];

// =========================================================
// ESS — Employee only (live UI: hrms-techculture.vercel.app)
// top nav: Dashboard · Self · Team · Request · Tasks
// green bar = subModules; sidebar sections (Personal Details…) = NOT permissions
// =========================================================
const ESS_TREE = [
  // Dashboard → My Home | Attendance Summary | Leave Summary
  {
    module: "Dashboard",
    heading: "",
    subModules: [
      { name: "My Home", actions: V },
      { name: "Attendance Summary", actions: V },
      { name: "Leave Summary", actions: V },
    ],
  },

  // Self → General Info | Time Sheet | … | Offboarding
  {
    module: "Self",
    heading: "",
    subModules: [
      { name: "General Info", actions: VEd },
      { name: "Time Sheet", actions: VC },
      { name: "Regularize Attendance", actions: VCC },
      { name: "My Web Punches", actions: V },
      { name: "On Tour/On Duty Entries", actions: VC },
      { name: "View Shift Roster", actions: V },
      { name: "Additional Request", actions: VCC },
      { name: "Offboarding", actions: V },
    ],
  },

  // Team → Team Dashboard | Team Chat | Mail
  {
    module: "Team",
    heading: "",
    subModules: [
      { name: "Team Dashboard", actions: V },
      { name: "Team Chat", actions: ["view", "create", "share"] },
      { name: "Mail", actions: ["view", "create", "email"] },
    ],
  },

  // Request → Employee Details | Attendance | … | Trip Tracking
  {
    module: "Request",
    heading: "",
    subModules: [
      { name: "Employee Details", actions: V },
      { name: "Attendance", actions: VCC },
      { name: "Web Punches", actions: V },
      { name: "On Tour/On Duty", actions: VCC },
      { name: "On Tour Cancellation", actions: VCC },
      { name: "Leave Applied", actions: VCC },
      { name: "Leave Cancellation", actions: VCC },
      { name: "Additional Request", actions: VCC },
      { name: "Offboarding Request", actions: VCC },
      { name: "Trip Tracking", actions: V },
    ],
  },

  // Tasks → Dashboard | To Do Tasks | Task Sheet
  {
    module: "Tasks",
    heading: "",
    subModules: [
      { name: "Dashboard", actions: ["view", "create"] },
      { name: "To Do Tasks", actions: ["view", "create", "edit"] },
      { name: "Task Sheet", actions: ["view", "create", "edit"] },
    ],
  },
];

// =========================================================
// HELPERS — simple, easy to follow
// =========================================================

// Combined catalog (admin + employee)
const MODULE_TREE = [...ADMIN_TREE, ...ESS_TREE];

// Unique module names
const MODULES = [...new Set(MODULE_TREE.map((b) => b.module))];

/**
 * Count how many action slots exist in a tree.
 * Example: one submodule with ["view", "edit"] = 2 slots.
 */
function countSlots(tree) {
  let total = 0;
  for (const block of tree) {
    for (const sub of block.subModules) {
      total += sub.actions.length;
    }
  }
  return total;
}

const TOTAL_PERMISSIONS = countSlots(ADMIN_TREE); // Super Admin / HR / Manager
const EMPLOYEE_TOTAL = countSlots(ESS_TREE); // Employee

/** Flat list of every page: { module, heading, subModule } */
const ALL_SUBS = [];
for (const block of MODULE_TREE) {
  for (const sub of block.subModules) {
    ALL_SUBS.push({
      module: block.module,
      heading: block.heading,
      subModule: sub.name,
    });
  }
}

/**
 * Convert an actions array into true/false flags.
 * ["view", "edit"] → { view: true, create: false, edit: true, … }
 */
function toFlags(allowed) {
  const flags = {};
  for (const action of ACTIONS) {
    flags[action] = allowed.includes(action);
  }
  return flags;
}

/**
 * Convert catalog tree into the shape saved on role.permissions.
 * Input:  { module, heading, subModules: [{ name, actions }] }
 * Output: { module, heading, subModules: [{ name, view, create, … }] }
 */
function buildFromTree(tree) {
  const result = [];
  for (const block of tree) {
    result.push({
      module: block.module,
      heading: block.heading,
      subModules: block.subModules.map((sub) => ({
        name: sub.name,
        ...toFlags(sub.actions),
      })),
    });
  }
  return result;
}

/** Get full permissions for a role name */
function permissionsForRole(role) {
  if (role === "Employee") return buildFromTree(ESS_TREE);
  return buildFromTree(ADMIN_TREE); // Super Admin, HR Manager, Manager
}

/** Max permission count for a role */
function totalForRole(role) {
  if (role === "Employee") return EMPLOYEE_TOTAL;
  return TOTAL_PERMISSIONS;
}

/** Count how many flags are true on a permissions array */
function countPermissions(perms) {
  let total = 0;
  for (const block of perms || []) {
    for (const sub of block.subModules || []) {
      for (const action of ACTIONS) {
        if (sub[action] === true) total += 1;
      }
    }
  }
  return total;
}

/**
 * Check if a module + page allows an action (used by route guards).
 * Example: findAction(perms, "Attendance", "Daily Attendance", "view")
 */
function findAction(perms, module, name, action) {
  for (const block of perms || []) {
    if (block.module !== module) continue;
    for (const sub of block.subModules || []) {
      if (sub.name === name && sub[action] === true) return true;
    }
  }
  return false;
}

/**
 * Same as findAction, but also matches heading.
 * Example: can(perms, "Dashboard", "Overview", "My Home", "view")
 */
function can(perms, module, heading, subName, action) {
  for (const block of perms || []) {
    if (block.module !== module || block.heading !== heading) continue;
    for (const sub of block.subModules || []) {
      if (sub.name === subName) return sub[action] === true;
    }
  }
  return false;
}

/**
 * Build frontend menu — only pages with view: true.
 * Returns: [{ module, headings: [{ name, subModules }] }]
 */
function menuForPermissions(perms) {
  const byModule = {};

  for (const block of perms || []) {
    // Keep only pages the user can view
    const visible = [];
    for (const sub of block.subModules || []) {
      if (!sub.view) continue;
      const actions = {};
      for (const a of ACTIONS) actions[a] = !!sub[a];
      visible.push({ name: sub.name, actions });
    }
    if (visible.length === 0) continue;

    if (!byModule[block.module]) {
      byModule[block.module] = { module: block.module, headings: [] };
    }
    byModule[block.module].headings.push({
      name: block.heading,
      subModules: visible,
    });
  }

  return Object.values(byModule);
}

/**
 * Merge client permissions with ADMIN_TREE on role update.
 * - Ignore anything not in the catalog
 * - An action can be true only if the catalog allows it
 * - Missing values become false
 */
function normalizePermissions(incoming, tree = ADMIN_TREE) {
  const result = [];

  for (const block of tree) {
    // Find matching block from the request body (if any)
    const fromClient =
      (incoming || []).find(
        (p) => p.module === block.module && p.heading === block.heading
      ) || {};

    const subs = [];
    for (const catalogSub of block.subModules) {
      const fromSub =
        (fromClient.subModules || []).find((s) => s.name === catalogSub.name) ||
        {};

      const flags = { name: catalogSub.name };
      for (const action of ACTIONS) {
        // true only when catalog allows it AND client sent true
        flags[action] =
          catalogSub.actions.includes(action) && fromSub[action] === true;
      }
      subs.push(flags);
    }

    result.push({
      module: block.module,
      heading: block.heading,
      subModules: subs,
    });
  }

  return result;
}

module.exports = {
  ACTIONS,
  ADMIN_TREE,
  ESS_TREE,
  MODULE_TREE,
  MODULES,
  ALL_SUBS,
  ALL_ROWS: ALL_SUBS,
  TOTAL_PERMISSIONS,
  EMPLOYEE_TOTAL,
  permissionsForRole,
  totalForRole,
  countPermissions,
  findAction,
  can,
  menuForPermissions,
  normalizePermissions,
  // Extra helpers (same idea, different names)
  allAccessPermissions: () => buildFromTree(ADMIN_TREE),
  employeePermissions: () => buildFromTree(ESS_TREE),
  emptyFlags: () => toFlags([]),
  applyFlags: (allowed, granted) => {
    const flags = {};
    for (const a of ACTIONS) {
      flags[a] = allowed.includes(a) && granted.includes(a);
    }
    return flags;
  },
};
