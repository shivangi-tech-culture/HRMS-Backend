/**
 * CHAT ACCESS — who is chatting, in which company, and with whom
 *
 * Chat user = login user + the company picked in the header switcher
 * (X-Company-Id header / socket auth.companyId; empty = first company).
 *
 * Contacts (teamDirectory):
 *   Super Admin / Admin / HR → everyone in the company (+ Super Admins / Admins)
 *   Reporting Manager        → their team (reportingHead1 / reportingHead2 = them)
 *   Employee                 → own Reporting Heads + every employee of the company
 *
 * Supervisors (all roles above Employee) may read chats where every member is in
 * their contacts, but only members can send.
 */
const User = require("../models/User");
const { verifyToken } = require("./jwt");
const {
  SUPER_ADMIN,
  ADMIN,
  HR,
  REPORTING_MANAGER,
  EMPLOYEE,
  normalizeRoleName,
  roleRank,
} = require("../config/roles");
const { companyListForUser } = require("./companyScope");
const { MANAGER_ROLES, headId, teamMemberFilter } = require("./teamScope");

const SUPERVISOR_ROLES = new Set([SUPER_ADMIN, ADMIN, HR, REPORTING_MANAGER]);
const ORGANIZATION_ROLES = new Set([SUPER_ADMIN, ADMIN, HR]);
const CACHE_TTL_MS = 60 * 1000;
const directoryCache = new Map();

const PERSON_SELECT =
  "name role official.officialEmail official.employeeCode official.designation official.department official.reportingHead1 official.reportingHead2";

/** Error with an HTTP status for the chat error handler / socket ack */
const chatError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/** May read chats of people in their contacts (never send in them) */
const isSupervisor = (role) => SUPERVISOR_ROLES.has(normalizeRoleName(role));

/** Reporting Managers, HR and admins can make project groups from their contacts */
const canCreateGroup = (role) => isSupervisor(role);

/**
 * Chat user from a login User (protect's req.user or a lean row).
 * requestedCompanyId must be one of the user's companies.
 */
const chatUserFor = async (user, requestedCompanyId) => {
  const companies = (await companyListForUser(user)).map((row) => ({
    id: String(row.companyId),
    name: row.companyName || "",
  }));
  const requested = String(requestedCompanyId || "").trim();
  const company = requested
    ? companies.find((c) => c.id === requested)
    : companies[0];
  if (!company) {
    throw requested
      ? chatError(403, "You do not belong to this company")
      : chatError(400, "Login user has no company");
  }

  return {
    employeeId: String(user._id),
    name: user.name || "",
    role: normalizeRoleName(user.role),
    companyId: company.id,
    companyName: company.name,
    companies,
    /** [reportingHead1, reportingHead2] User _ids; "" when not set */
    headIds: [user.official?.reportingHead1, user.official?.reportingHead2].map(headId),
  };
};

/** Socket handshake: same JWT + Active check as protect() */
const loadLoginUser = async (token) => {
  if (!token) throw chatError(401, "Login token is required");
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw chatError(401, "Login token is invalid or expired");
  }
  const user = await User.findById(decoded.id)
    .select("name role status official.companyIds official.reportingHead1 official.reportingHead2")
    .lean();
  if (!user || user.status !== "Active") {
    throw chatError(401, "User not found or inactive");
  }
  return user;
};

/** Contact card shown in the chat people list */
const toPerson = (row, relation) => ({
  employeeId: String(row._id),
  name: row.name || "",
  email: row.official?.officialEmail || "",
  employeeCode: row.official?.employeeCode || "",
  role: normalizeRoleName(row.role),
  designation: row.official?.designation || "",
  department: row.official?.department || "",
  relation,
});

const findPeople = (filter) =>
  User.find({ status: "Active", ...filter }).select(PERSON_SELECT).sort({ name: 1 }).lean();

/** Super Admin / Admin / HR: platform admins + everyone in the company, senior roles first */
const organizationDirectory = async (user) => {
  const [platform, staff] = await Promise.all([
    findPeople({ role: { $in: [SUPER_ADMIN, ADMIN] } }),
    findPeople({
      role: { $nin: [SUPER_ADMIN, ADMIN] },
      "official.companyIds": user.companyId,
    }),
  ]);
  return [...platform, ...staff]
    .map((row) => toPerson(row, normalizeRoleName(row.role)))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
};

/** Reporting Manager: their team in this company */
const managerDirectory = async (user) => {
  const team = await findPeople({
    ...teamMemberFilter({ _id: user.employeeId }),
    "official.companyIds": user.companyId,
  });
  return team.map((row) =>
    toPerson(
      row,
      headId(row.official?.reportingHead1) === user.employeeId ? "Team" : "Team (secondary)"
    )
  );
};

/** Employee: own Reporting Heads, then every employee of the company (own team first) */
const employeeDirectory = async (user) => {
  const headIds = user.headIds.filter(Boolean);
  const [headRows, colleagues] = await Promise.all([
    headIds.length ? findPeople({ _id: { $in: headIds } }) : [],
    findPeople({ role: EMPLOYEE, "official.companyIds": user.companyId }),
  ]);
  const headsById = new Map(headRows.map((row) => [String(row._id), row]));
  const heads = user.headIds
    .map((id, i) => headsById.has(id) && toPerson(headsById.get(id), `Reporting Head ${i + 1}`))
    .filter(Boolean);

  const myHeads = new Set(headIds);
  const people = colleagues
    .map((row) => {
      const shared = [row.official?.reportingHead1, row.official?.reportingHead2]
        .map(headId)
        .some((id) => myHeads.has(id));
      return toPerson(row, shared ? "Teammate" : "Colleague");
    })
    .sort((a, b) => Number(b.relation === "Teammate") - Number(a.relation === "Teammate"));

  return [...heads, ...people];
};

const loadDirectory = async (user) => {
  let people;
  if (ORGANIZATION_ROLES.has(user.role)) people = await organizationDirectory(user);
  else if (MANAGER_ROLES.includes(user.role)) people = await managerDirectory(user);
  else people = await employeeDirectory(user);

  const byId = new Map();
  for (const person of people) {
    if (person.employeeId === user.employeeId || byId.has(person.employeeId)) continue;
    byId.set(person.employeeId, person);
  }
  return [...byId.values()];
};

/** Chat contacts for this user in the selected company. Cached for a minute. */
const teamDirectory = async (user) => {
  const key = `${user.employeeId}|${user.companyId}`;
  const hit = directoryCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await loadDirectory(user);
  directoryCache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  if (directoryCache.size > 500) {
    for (const [k, v] of directoryCache) if (v.expires <= Date.now()) directoryCache.delete(k);
  }
  return value;
};

/** otherEmployeeId must be one of the user's contacts */
const assertInTeam = async (user, otherEmployeeId) => {
  const other = String(otherEmployeeId || "").trim();
  if (!other || other === user.employeeId) {
    throw chatError(400, "Choose another employee");
  }
  const people = await teamDirectory(user);
  if (!people.some((person) => person.employeeId === other)) {
    throw chatError(403, "You can only chat with people in your team");
  }
  return other;
};

/**
 * A participant can always open their chat (the other person started it from their own team).
 * A supervisor can read a chat when every member is in their contacts.
 */
const canViewConversation = async (user, conversation) => {
  if (!conversation || conversation.companyId !== user.companyId) return false;
  const ids = conversation.participantIds.map(String);
  if (ids.includes(user.employeeId)) return true;
  if (!isSupervisor(user.role)) return false;
  const teamIds = new Set((await teamDirectory(user)).map((person) => person.employeeId));
  return ids.every((id) => teamIds.has(id));
};

const canSend = (user, conversation) =>
  conversation.participantIds.map(String).includes(user.employeeId);

module.exports = {
  chatError,
  isSupervisor,
  canCreateGroup,
  chatUserFor,
  loadLoginUser,
  teamDirectory,
  assertInTeam,
  canViewConversation,
  canSend,
};
