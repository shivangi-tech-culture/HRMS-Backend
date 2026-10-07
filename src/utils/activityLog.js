/**
 * Activity log helper — who changed which employee, field by field (never throws to API).
 *
 * Usage on update:
 *   const before = user.toObject();   // right after load
 *   ...change + save...
 *   await logEmployeeActivity({ actor: req.user, employee: user, action: "update", before });
 *
 * changes[] = [{ field: "personal.mobileNo", label: "Mobile No", from: "98…", to: "99…" }]
 * List rows (accounts, education, …) also carry itemId.
 */
const mongoose = require("mongoose");
const ActivityLog = require("../models/ActivityLog");
const Company = require("../models/Company");
const User = require("../models/User");
const { userCompanyIds } = require("./companyScope");

const SIMPLE_FIELDS = ["name", "role", "status", "avatar"];
const OBJECT_SECTIONS = ["personal", "official", "other", "payroll"];
const LIST_SECTIONS = ["education", "accounts", "family", "nominees", "experience", "visas"];
/** First non-empty key used as the row title when a list row is added / removed */
const ROW_TITLE_KEYS = ["courseName", "bankName", "name", "organization", "nomineeName", "countryName", "accountNo"];

const VERBS = {
  create: "created",
  update: "updated",
  delete: "deleted",
  section_update: "updated",
  section_delete: "deleted",
};

const isOid = (v) => v instanceof mongoose.Types.ObjectId || v?._bsontype === "ObjectId";
const isPlainObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !isOid(v);

/** Comparable value: ids → string, dates → YYYY-MM-DD, empty → null */
const plain = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (isOid(v)) return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.length ? v.map(plain) : null;
  return v;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LABELS = {
  reportingHead1: "Reporting Manager 1",
  reportingHead2: "Reporting Manager 2",
  companyIds: "Companies",
  branchId: "Branch",
  shiftId: "Shift",
};

/** "presentAddress.city" → "Present Address City" */
const humanize = (path) =>
  path
    .split(".")
    .map(
      (part) =>
        LABELS[part] ||
        part.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
    )
    .join(" ");

/** { a: { b: 1 } } → { "a.b": 1 } */
const flatten = (obj, prefix = "", out = {}) => {
  for (const [key, value] of Object.entries(obj || {})) {
    if (key === "_id" || key === "__v") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) flatten(value, path, out);
    else out[path] = plain(value);
  }
  return out;
};

const change = (field, label, from, to, itemId) => ({
  field,
  label,
  from,
  to,
  ...(itemId ? { itemId: String(itemId) } : {}),
});

const rowTitle = (row) => {
  for (const key of ROW_TITLE_KEYS) if (row?.[key]) return String(row[key]);
  return "row";
};

/** Field-level diff of two User snapshots (toObject()) */
const diffUser = (before = {}, after = {}) => {
  const changes = [];

  for (const key of SIMPLE_FIELDS) {
    const from = plain(before[key]);
    const to = plain(after[key]);
    if (!same(from, to)) changes.push(change(key, humanize(key), from, to));
  }
  if ((before.password || "") !== (after.password || "")) {
    changes.push(change("password", "Password", null, "changed"));
  }

  for (const section of OBJECT_SECTIONS) {
    const a = flatten(before[section]);
    const b = flatten(after[section]);
    for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!same(a[path] ?? null, b[path] ?? null)) {
        changes.push(change(`${section}.${path}`, humanize(path), a[path] ?? null, b[path] ?? null));
      }
    }
  }

  for (const section of LIST_SECTIONS) {
    const rows = (list) => new Map((list || []).map((row) => [String(row._id), row]));
    const a = rows(before[section]);
    const b = rows(after[section]);
    const label = humanize(section);
    for (const [id, row] of a) {
      if (!b.has(id)) changes.push(change(section, `${label} removed`, rowTitle(row), null, id));
    }
    for (const [id, row] of b) {
      if (!a.has(id)) {
        changes.push(change(section, `${label} added`, null, rowTitle(row), id));
        continue;
      }
      const fa = flatten(a.get(id));
      const fb = flatten(row);
      for (const path of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
        if (!same(fa[path] ?? null, fb[path] ?? null)) {
          changes.push(change(`${section}.${path}`, `${label} ${humanize(path)}`, fa[path] ?? null, fb[path] ?? null, id));
        }
      }
    }
  }

  return changes;
};

/** Replace reporting-head / company ids with names so the UI can show them directly */
const resolveNames = async (changes) => {
  const isHead = (c) => /reportingHead[12]$/.test(c.field);
  const isCompany = (c) => c.field === "official.companyIds";
  const ids = (pick) =>
    [...new Set(changes.filter(pick).flatMap((c) => [c.from, c.to].flat()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );

  const headIds = ids(isHead);
  const companyIds = ids(isCompany);
  if (!headIds.length && !companyIds.length) return changes;

  const [heads, companies] = await Promise.all([
    headIds.length ? User.find({ _id: { $in: headIds } }).select("name").lean() : [],
    companyIds.length ? Company.find({ _id: { $in: companyIds } }).select("companyName").lean() : [],
  ]);
  const names = new Map([
    ...heads.map((u) => [String(u._id), u.name]),
    ...companies.map((c) => [String(c._id), c.companyName]),
  ]);
  const name = (v) => (Array.isArray(v) ? v.map(name).join(", ") : v ? names.get(String(v)) || v : v);

  return changes.map((c) => (isHead(c) || isCompany(c) ? { ...c, from: name(c.from), to: name(c.to) } : c));
};

/** Accepts change objects or plain field strings (older callers) */
const normalizeChanges = (changes = []) =>
  changes.map((c) => (typeof c === "string" ? change(c, humanize(c.split(".").pop()), null, null) : c));

const personFromUser = (user = {}, company = "") => ({
  id: user._id,
  name: user.name || "",
  officialEmail: user.official?.officialEmail || "",
  employeeCode: user.official?.employeeCode || "",
  role: user.role || "",
  company,
  department: user.official?.department || "",
  designation: user.official?.designation || "",
});

/** Map companyId → companyName for the given ids */
const companyNameMap = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await Company.find({ _id: { $in: ids } }).select("companyName").lean();
  return new Map(rows.map((row) => [String(row._id), row.companyName]));
};

/** "HR Manager updated Employee One — Mobile No, City +2 more" */
const buildSummary = (actor, employee, action, section, changes, before) => {
  const self = String(actor._id) === String(employee._id);
  const target = self ? "own profile" : before?.name || employee.name || "employee";
  const what = section && action.startsWith("section") ? ` ${section} of` : "";
  const labels = changes.map((c) => c.label).filter(Boolean);
  const fields = labels.length
    ? ` — ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` +${labels.length - 3} more` : ""}`
    : "";
  return `${actor.name || "Someone"} ${VERBS[action] || action}${what} ${target}${fields}`;
};

/**
 * Persist one activity row. Failures are logged only — create/update still succeed.
 * Pass `before` (toObject() snapshot) to auto-compute changes; update with no real change is skipped.
 */
const logEmployeeActivity = async ({
  actor,
  employee,
  action,
  section = "",
  summary = "",
  before = null,
  changes = null,
  meta = {},
}) => {
  try {
    if (!actor?._id || !employee?._id || !action) return null;

    let list = changes
      ? normalizeChanges(changes)
      : before
        ? diffUser(before, typeof employee.toObject === "function" ? employee.toObject() : employee)
        : [];
    if (action === "update" && before && !list.length) return null;
    list = await resolveNames(list);

    const employeeCompanyIds = userCompanyIds(employee);
    const actorCompanyIds = userCompanyIds(actor);
    const names = await companyNameMap([...new Set([...employeeCompanyIds, ...actorCompanyIds])]);
    const namesOf = (ids) => ids.map((id) => names.get(id)).filter(Boolean).join(", ");

    const employeeRef = personFromUser(employee, namesOf(employeeCompanyIds));
    const actorRef = personFromUser(actor, namesOf(actorCompanyIds));

    return await ActivityLog.create({
      employee: employeeRef,
      actor: actorRef,
      action,
      section: section || "",
      summary: summary || buildSummary(actor, employee, action, section, list, before),
      changes: list,
      meta: meta || {},
      company: employeeRef.company,
      companyIds: employeeCompanyIds,
    });
  } catch (err) {
    console.error("Activity log failed:", err.message);
    return null;
  }
};

module.exports = { logEmployeeActivity, personFromUser, diffUser, humanize };
