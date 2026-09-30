/**
 * ROLE HIERARCHY — single source of truth for system roles
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Super Admin  (exactly 1)                                   │
 * │  • All companies · full access                              │
 * │  • Creates Admin · assigns multi-company to HR              │
 * │  • Cannot be created by Admin                               │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Admin  (many)                                              │
 * │  • All companies · full access                              │
 * │  • Created only by Super Admin                              │
 * │  • Cannot create / assign Super Admin                       │
 * ├─────────────────────────────────────────────────────────────┤
 * │  HR Manager  (many)                                         │
 * │  • Multi-company access when Super Admin assigns companies[]│
 * │  • Manages employees within assigned companies              │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Reporting Manager  (many)                                  │
 * │  • Single company · team (direct reports) only              │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Employee  (many)                                           │
 * │  • Own profile / ESS only                                   │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Legacy aliases (normalized at login / authorize):
 *   Global Admin → Super Admin (role removed; users should be migrated)
 *   Manager      → Reporting Manager
 */

const SUPER_ADMIN = "Super Admin";
const ADMIN = "Admin";
const HR = "HR Manager";
const REPORTING_MANAGER = "Reporting Manager";
const EMPLOYEE = "Employee";

/** Canonical system role names (seed + Role docs) */
const SYSTEM_ROLES = [
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
];

/**
 * Roles with admin-side catalog (not ESS-only).
 * Used by authorize(...ALL_ACCESS) on admin routes.
 */
const ALL_ACCESS = [SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER];

/**
 * Gates that include these also admit custom admin-catalog roles.
 */
const DELEGATABLE_ADMIN = [HR, REPORTING_MANAGER];

/** Platform lean accounts (login only — no full HR profile) */
const PLATFORM_ROLES = [SUPER_ADMIN, ADMIN];

/** All-company tenant access (no company filter) */
const GLOBAL_COMPANY_ROLES = [SUPER_ADMIN, ADMIN];

/** May receive official.companies[] (multi-company) — Super Admin assigns */
const MULTI_COMPANY_ROLES = [HR];

/** Single-company + team scope */
const TEAM_SCOPED_ROLES = [REPORTING_MANAGER];

/** Locked permission matrix (always full ADMIN_TREE) */
const LOCKED_ROLES = [SUPER_ADMIN, ADMIN];

/** Soft cap: only one Super Admin account */
const maxSuperAdmins = () => {
  const n = Number(process.env.MAX_SUPER_ADMINS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
};

/**
 * Map old / alternate names → canonical role.
 * Keeps existing JWT sessions working after rename.
 */
const ROLE_ALIASES = {
  "global admin": SUPER_ADMIN,
  "super admin": SUPER_ADMIN,
  admin: ADMIN,
  hr: HR,
  "hr manager": HR,
  manager: REPORTING_MANAGER,
  "reporting manager": REPORTING_MANAGER,
  hod: REPORTING_MANAGER,
  employee: EMPLOYEE,
};

const normalizeRoleName = (roleName) => {
  const raw = String(roleName || "").trim();
  if (!raw) return raw;
  const mapped = ROLE_ALIASES[raw.toLowerCase()];
  return mapped || raw;
};

const isSuperAdmin = (userOrRole) =>
  normalizeRoleName(
    typeof userOrRole === "string" ? userOrRole : userOrRole?.role
  ) === SUPER_ADMIN;

const isAdmin = (userOrRole) =>
  normalizeRoleName(
    typeof userOrRole === "string" ? userOrRole : userOrRole?.role
  ) === ADMIN;

const isPlatformRole = (roleName) =>
  PLATFORM_ROLES.includes(normalizeRoleName(roleName));

const isLockedRoleName = (roleName) =>
  LOCKED_ROLES.includes(normalizeRoleName(roleName));

const hasGlobalCompanyRole = (userOrRole) =>
  GLOBAL_COMPANY_ROLES.includes(
    normalizeRoleName(
      typeof userOrRole === "string" ? userOrRole : userOrRole?.role
    )
  );

const isMultiCompanyRole = (roleName) =>
  MULTI_COMPANY_ROLES.includes(normalizeRoleName(roleName));

const isTeamScopedRole = (roleName) =>
  TEAM_SCOPED_ROLES.includes(normalizeRoleName(roleName));

/**
 * Hierarchy rank (lower = higher privilege).
 * Used for "can manage role" checks.
 */
const RANK = {
  [SUPER_ADMIN]: 0,
  [ADMIN]: 1,
  [HR]: 2,
  [REPORTING_MANAGER]: 3,
  [EMPLOYEE]: 4,
};

const roleRank = (roleName) => {
  const n = normalizeRoleName(roleName);
  return RANK[n] ?? 99;
};

/**
 * Who may create / edit / delete a target role.
 *
 * Super Admin → anyone (including Admin); only one Super Admin total
 * Admin       → HR, Reporting Manager, Employee (NOT Super Admin, NOT Admin)
 * HR          → Employee only (via employee APIs typically)
 * Others      → no Access & Control user management
 */
const canManageRole = (actorRole, targetRole) => {
  const actor = normalizeRoleName(actorRole);
  const target = normalizeRoleName(targetRole);

  if (actor === SUPER_ADMIN) return true;

  if (actor === ADMIN) {
    return [HR, REPORTING_MANAGER, EMPLOYEE].includes(target);
  }

  if (actor === HR) {
    return target === EMPLOYEE;
  }

  return false;
};

/**
 * Who may assign official.companies[] to HR.
 * Only Super Admin (per product rule).
 */
const canAssignCompanies = (userOrRole) => isSuperAdmin(userOrRole);

/**
 * Roles visible on Access & Control list for this actor.
 * null = no role filter (see everyone the company scope allows).
 */
const visibleRoleFilter = (actorRole) => {
  const actor = normalizeRoleName(actorRole);
  if (actor === SUPER_ADMIN) return null;
  if (actor === ADMIN) {
    return { role: { $nin: [SUPER_ADMIN, "Global Admin"] } };
  }
  if (actor === HR) {
    return {
      role: {
        $nin: [SUPER_ADMIN, ADMIN, "Global Admin", "Super Admin"],
      },
    };
  }
  // Reporting Manager / Employee — team or self handled elsewhere
  return {
    role: {
      $in: [EMPLOYEE, REPORTING_MANAGER, "Manager", HR, "HR Manager"],
    },
  };
};

/** Short descriptions for seed / API docs */
const ROLE_DESCRIPTIONS = {
  [SUPER_ADMIN]:
    "Single top account. All companies, full access. Creates Admin; assigns multi-company to HR.",
  [ADMIN]:
    "Multiple allowed. All companies, full access. Created by Super Admin. Cannot create Super Admin.",
  [HR]:
    "Multi-company when Super Admin assigns official.companies. Manages employees in those companies.",
  [REPORTING_MANAGER]:
    "Single company. Sees / manages only their team (reportingHead).",
  [EMPLOYEE]: "Own ESS access only (Self / Team / Request / Tasks).",
};

module.exports = {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  SYSTEM_ROLES,
  ALL_ACCESS,
  DELEGATABLE_ADMIN,
  PLATFORM_ROLES,
  GLOBAL_COMPANY_ROLES,
  MULTI_COMPANY_ROLES,
  TEAM_SCOPED_ROLES,
  LOCKED_ROLES,
  ROLE_ALIASES,
  ROLE_DESCRIPTIONS,
  maxSuperAdmins,
  normalizeRoleName,
  isSuperAdmin,
  isAdmin,
  isPlatformRole,
  isLockedRoleName,
  hasGlobalCompanyRole,
  isMultiCompanyRole,
  isTeamScopedRole,
  roleRank,
  canManageRole,
  canAssignCompanies,
  visibleRoleFilter,
};
