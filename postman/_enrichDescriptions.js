/**
 * Enrich HRMS Postman collection:
 * - Query / form-data: description on each param (visible in Params / Body tabs)
 * - Raw JSON: ### Parameters block in request description (type + how to send)
 *
 * Run: node postman/_enrichDescriptions.js
 */
const fs = require("fs");
const path = require("path");

const COLLECTION = path.join(__dirname, "HRMS_API.postman_collection.json");
const MARKER_START = "\n\n---\n### Parameters (type + how to send)\n";
const MARKER_END = "\n---\n";

/** Shared param docs — key matches query key OR last segment of body path */
const PARAM_DOCS = {
  // ── query / common ──────────────────────────────────────────────
  page: "number | optional | page number, default `1`",
  limit: "number | optional | rows per page (usually 1–200)",
  search: "string | optional | name / email / employee code text search",
  isActive: "boolean | optional | `true` or `false`",
  from: "string (YYYY-MM-DD) | optional | range start date",
  to: "string (YYYY-MM-DD) | optional | range end date",
  date: "string (YYYY-MM-DD) | optional/required by API | single day",
  month: "string (YYYY-MM) | optional | e.g. `2026-03`",
  year: "string/number | optional | e.g. `2026`",
  company: "string | optional | company name (exact master name)",
  department: "string | optional | department name",
  designation: "string | optional | designation name",
  gender: "string | optional | Gender master name e.g. `Male` / `Female`",
  branch: "string | optional | current branch filter — Branch `_id`, branch name or branch code (e.g. `NOI`)",
  shift: "string | optional | current shift filter — Shift `_id`, shift name or shift code (e.g. `GS-01`)",
  branchId: "string (MongoId 24-hex) | path | Branch master `_id` that is on this company (from GET /api/companies/{id} → branches[].branchId._id)",
  location: "string | optional | match punch address text",
  role: "string | optional | role name e.g. `Super Admin` | `Admin` | `HR Manager` | `Reporting Manager` | `Employee`",
  employeeId: "string (MongoId 24-hex) | optional/required | user `_id`",
  managerId: "string (MongoId 24-hex) | required on assign, optional on unassign | Reporting Manager user `_id`",
  employeeIds: "array<string> (MongoId 24-hex) | required | 1–500 Employee user `_id`s (bulk)",
  level: "number | optional | `1` = reportingHead1 (default on assign), `2` = reportingHead2",
  companyId:
    "string (MongoId 24-hex or company name) | optional | company selected in the UI ({{companyId}}) — untick / omit for all companies",
  unassigned: "boolean | optional | `true` = only employees with no reporting manager",
  action: "string | optional | `create` | `update` | `delete` | `section_update` | `section_delete`",
  section: "string | optional | profile section e.g. `official` | `personal` | `accounts` | `payroll`",
  source: "string | required for punch | `web` | `mobile` | `biometric`",
  type: "string | depends on API | see request notes / enum in body",
  status:
    "string | optional | context enum — Active/Inactive OR Present/Absent/Late/… OR Pending/Approved/…",

  // ── auth / account ─────────────────────────────────────────────
  officialEmail: "string (email) | required | login email",
  password: "string | required (min 6) | plain password; blank on update = keep",
  name: "string | required/optional | display / full name (min 2)",
  description: "string | optional | free text notes",

  // ── access / roles ─────────────────────────────────────────────
  catalog: "string | required | `admin` OR `employee` (do not mix modules)",
  permissions: "array<object> | required | module permission matrix objects",
  subject: "string | required | email subject",
  body: "string | required | email body text/HTML",
  isHtml: "boolean | optional | `true` if body is HTML, default false",

  // ── official / personal (nested) ───────────────────────────────
  "official.officialEmail": "string (email) | required on create | work login email",
  "official.employeeCode": "string | optional | uppercase code e.g. `EMP-1024`",
  "official.company":
    "string | optional | filled from Company.companyName of companyIds[0]",
  "official.companyIds":
    "string[] (MongoId) | required | array of Company `_id`s ({{companyOrgId}}). Employee and Reporting Manager: exactly one id. HR: one or more. Only Super Admin may send more than one",
  companyIds:
    "string[] (MongoId) | company ids on the user",
  "official.companies":
    "string[] | optional | multi-company list — Super Admin assigns to HR Manager only",
  "official.department": "string | often required | department master name",
  "official.designation": "string | optional | designation master name",
  "official.jobRole": "string | optional | job role master name",
  "official.grade": "string | optional | grade master name",
  "official.reportingHead1":
    "string (MongoId) | optional | Reporting Manager `_id` from GET /api/companies/{id} → reportingManagers[] (\"\" or null clears). Bulk: POST /api/employees/assign-manager",
  "official.reportingHead2": "string (MongoId) | optional | 2nd Reporting Manager `_id` (same list); cannot equal reportingHead1",
  "official.branchId":
    "string (MongoId) | optional | Branch `_id` from GET /api/companies/{id} → branches[].branchId._id. Create / Get / Update response returns `{ _id, name, code, address, city, state }`",
  "official.shiftId":
    "string (MongoId) | optional | Shift `_id` from GET /api/companies/{id} → branches[].shifts[].shiftId._id. Needs branchId. Create / Get / Update response returns `{ _id, name, code, monthlySchedule }` — week 1–5 day timings of this shift on the user's company branch",
  "official.dateOfJoining": "string/date (YYYY-MM-DD) | optional | joining date",
  "official.calculateSalaryFrom": "string/date (YYYY-MM-DD) | optional",
  "official.dateOfRetirement": "string/date|null | optional",
  companies:
    "string[] | optional | same as official.companies — HR multi-company access",
  id: "string (MongoId) | path | resource `_id`",
  q: "string | optional | alias for search",
  query: "string | optional | alias for search",
  keyword: "string | optional | alias for search",

  "personal.mobileNo": "string | optional | 10-digit mobile digits only",
  "personal.workPhone": "string | optional | office phone",
  "personal.workExt": "string | optional | extension",
  "personal.dateOfBirth": "string/date (YYYY-MM-DD) | optional",
  "personal.aadhaarNo": "string | optional | 12 digits",
  "personal.panNo": "string | optional | PAN e.g. `ABCDE1234F`",
  "personal.gender": "string | optional | Gender master name",
  "personal.maritalStatus": "string | optional | Marital Status master name",
  "personal.fatherOrHusbandName": "string | optional",
  "personal.spouseName": "string | optional",
  "personal.anniversaryDate": "date|null | optional | ignored by API (auto)",
  "personal.personalEmail": "string (email) | optional",
  "personal.languageKnown": "string | optional",
  "personal.emergencyContact1": "string | optional",
  "personal.emergencyContact2": "string | optional",
  "personal.drivingLicenseNo": "string | optional",
  "personal.licenseValidUpto": "date|null | optional",
  "personal.passportNo": "string | optional",
  "personal.remarks": "string | optional",
  "personal.presentAddress.address": "string | optional",
  "personal.presentAddress.country": "string | optional | free text",
  "personal.presentAddress.state": "string | optional | free text",
  "personal.presentAddress.city": "string | optional | free text",
  "personal.presentAddress.pincode": "string | optional",
  "personal.permanentAddress.address": "string | optional",
  "personal.permanentAddress.country": "string | optional",
  "personal.permanentAddress.state": "string | optional",
  "personal.permanentAddress.city": "string | optional",
  "personal.permanentAddress.pincode": "string | optional",

  "other.bloodGroup": "string | optional | Blood Group master",
  "other.passportExpiry": "string/date | optional",

  education: "array<object> | optional | education rows (courseType, courseLevel, …)",
  accounts: "array<object> | optional | bank account rows",
  family: "array<object> | optional | family rows",
  nominees: "array<object> | optional | nominee rows",
  experience: "array<object> | optional | experience rows",
  visas: "array<object> | optional | visa rows",
  _id: "string (MongoId) | optional | existing sub-document id for edit",
  "accounts._id": "string (MongoId) | for edit list item",
  "accounts.bankName": "string | Bank Name master",
  "accounts.ifscCode": "string | IFSC e.g. `HDFC0001234`",
  "accounts.active": "boolean | account active flag",

  // payroll
  "payroll.basic": "number/string | optional | basic salary",
  "payroll.annualCtc": "number/string | optional",
  "payroll.paymentMode": "string | optional",
  "payroll.ifsc": "string | optional | IFSC",
  "payroll.uanNo": "string | optional",
  "payroll.bankName": "string | optional",
  "payroll.bankAccount": "string | optional",
  "payroll.salaryGroup": "string | optional",
  "payroll.salaryDate": "string | optional",
  "payroll.appraisalDuration": "string | optional",
  "payroll.grossSalary": "number | optional",
  "payroll.totalEarning": "number | optional",
  "payroll.totalDeduction": "number | optional",
  "payroll.appraisalDate": "date|null | optional",
  "payroll.ot1Rate": "number | optional",
  "payroll.ot2Rate": "number | optional",
  "payroll.remarks": "string | optional",
  "payroll.pfApply": "boolean | optional",
  "payroll.pfEmployerShare": "boolean | optional",
  "payroll.pfNo": "string | optional",
  "payroll.pfType": "string | optional",
  "payroll.pf": "string/number | optional",
  "payroll.pfApplyFrom": "date|null | optional",
  "payroll.pfApplyTo": "date|null | optional",
  "payroll.esiApply": "boolean | optional",
  "payroll.esiNo": "string | optional",
  "payroll.esiEmployerShare": "boolean | optional",
  "payroll.esiApplyFrom": "date|null | optional",
  "payroll.esiApplyTo": "date|null | optional",
  "payroll.ptApply": "boolean | optional",
  "payroll.tdsApply": "boolean | optional",
  "payroll.taxRegime": "string | optional | e.g. `New` / `Old`",

  // masters
  // type already covered — master create uses specific values

  // attendance / punch
  latitude: "number | required | GPS latitude (-90…90) — send as number, not string",
  longitude: "number | required | GPS longitude (-180…180) — send as number, not string",
  remarks: "string | optional | max ~500 chars",

  code: "string | required | uppercase short code e.g. `5DAY`",
  startTime: "string (HH:mm) | required | shift start 24h",
  endTime: "string (HH:mm) | required | shift end 24h",

  // company org (/api/companies) — Super Admin / Admin only
  companyName: "string | required on create | company display name (min 2)",
  companyCode: "string | required on create | unique code, stored uppercase e.g. `ABC`",
  companyOrgId: "string (MongoId 24-hex) | path | Company org `_id` from Create / List",
  branches: "array<object> | optional | company branches — branchId (master), address, shifts[].shiftId + monthlySchedule. Update replaces the whole list",
  "branches.branchId": "string (MongoId) | required | Branch master `_id` (GET /api/masters?type=branch); once per company",
  "branches.shifts": "array<object> | optional | shifts on this branch",
  "branches.shifts.shiftId": "string (MongoId) | required | Shift master `_id` (GET /api/masters?type=shift); once per branch",
  "branches.shifts.isActive": "boolean | optional | `false` hides this shift from dropdowns",
  monthlySchedule: "array<object> | optional | week 1–5 pattern for the shift (not a one-off date)",
  weekNumber: "number | required | `1`–`5`, unique inside the shift",
  days: "array<object> | required | all 7 weekdays, each once",
  day: "string | required | `monday` … `sunday`",
  isOff: "boolean | optional | `true` = off (times may be omitted). Working day needs startTime + endTime",
  breakStartTime: "string (HH:mm) | optional | blank if no break; both break times required together",
  breakEndTime: "string (HH:mm) | optional | must be after breakStartTime and inside shift hours",
  "branches.address": "string | optional | branch address",
  "branches.city": "string | optional | branch city",
  "branches.state": "string | optional | branch state",

  // mail
  // formdata
  document: "file | required | upload binary file (multipart form-data)",
};

/** Context-aware overrides by request name / URL */
function contextualDoc(key, ctx) {
  const name = (ctx.name || "").toLowerCase();
  const url = (ctx.url || "").toLowerCase();
  const isMasterApi =
    url.includes("/masters") ||
    name.includes("master") ||
    /\b(company|department|designation|division|grade|job role|gender|marital|blood|bank|relation|nominate|visa|course|reason)\b/i.test(
      name
    );
  const isAttendanceApi = url.includes("/attendance") && !isMasterApi;

  if (key === "code" && (url.includes("type=branch") || url.includes("type=shift") || name.includes("branch master") || name.includes("shift master"))) {
    return "string | optional | short code, unique inside the type, stored uppercase e.g. `NOIDA` / `GS-01`";
  }

  if (key === "managerId" && url.includes("/api/employees")) {
    return "string (MongoId 24-hex) | optional | only employees reporting to this manager (either head)";
  }
  if (key === "companyId" && url.includes("/assign-manager")) {
    return "string (MongoId 24-hex) | required | company selected on the list — manager and all employees must belong to it";
  }
  if (key === "managerId" && url.includes("/assign-manager")) {
    return "string (MongoId 24-hex) or null | required | Reporting Manager `_id` from GET /api/companies/{id} → reportingManagers[]; `null` = remove manager";
  }
  if (key === "level" && url.includes("/assign-manager")) {
    return "number | optional | `1` = reportingHead1 (default), `2` = reportingHead2. With managerId null and no level → both heads cleared";
  }
  if (key === "search" && url.includes("/activity")) {
    return "string | optional | employee name / code / email, changed-by name or summary text (admin only)";
  }
  if (key === "employeeId" && url.includes("/activity")) {
    return "string (MongoId 24-hex) | optional | one person's history — changes made on them OR by them (admin only; Employee always sees own)";
  }

  if (key === "search" && url.includes("/api/companies")) {
    return "string | optional | match company name or company code";
  }
  if (key === "isActive" && url.includes("/api/companies")) {
    if (name.includes("list")) {
      return "boolean | optional | `true` or `false` — omit to list all";
    }
    return "boolean | optional | `true` keeps the company active";
  }

  if (key === "status") {
    if (isAttendanceApi)
      return "string | optional | `ALL` | `Pending` | `Present` | `Absent` | `HalfDay` | `WeeklyOff` | `Holiday` | `MissedPunch` | `OnLeave` | `WFH`";
    return "string | optional | `Active` or `Inactive`";
  }

  if (key === "type") {
    if (isMasterApi || url.includes("/masters"))
      return "string | required | master type key e.g. `department`, `designation`, `regularizationReason`, `markAttendanceReason` (company is not a master)";
    if (name.includes("upload") || name.includes("attachment"))
      return "string | required | attachment category key (form-data text)";
    return PARAM_DOCS.type;
  }

  if (key === "role") {
    if (name.includes("create") || name.includes("update"))
      return "string | required on create | `Admin` | `HR Manager` | `Reporting Manager` | `Employee` | custom role name";
    return "string | optional filter | role name e.g. `Employee` / `HR Manager`";
  }

  return null;
}

function describeKey(key, ctx) {
  const ctxDoc = contextualDoc(key, ctx);
  if (ctxDoc) return ctxDoc;
  if (PARAM_DOCS[key]) return PARAM_DOCS[key];
  // nested fallback: last segment
  const leaf = key.includes(".") ? key.split(".").pop() : key;
  if (PARAM_DOCS[leaf]) return PARAM_DOCS[leaf] + ` (field: \`${key}\`)`;
  // infer from value sample
  return "see sample value | send same JSON type as example (string/number/boolean/array/object/null)";
}

function parseRaw(raw) {
  if (!raw) return null;
  let s = String(raw);
  s = s.replace(/:\s*\{\{([^}]+)\}\}/g, ': "{{$1}}"');
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function flattenObj(obj, prefix = "", out = {}) {
  if (obj === null || obj === undefined) {
    out[prefix || "(root)"] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    out[prefix] = obj;
    if (obj.length && obj[0] && typeof obj[0] === "object" && !Array.isArray(obj[0])) {
      flattenObj(obj[0], prefix, out);
    }
    return out;
  }
  if (typeof obj !== "object") {
    out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenObj(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function inferTypeFromValue(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "object") return "object";
  return "string";
}

function stripOldParamsBlock(desc) {
  if (!desc) return "";
  const s = String(desc);
  const i = s.indexOf(MARKER_START);
  if (i === -1) {
    // also strip older variant without leading newlines
    const j = s.indexOf("### Parameters (type + how to send)");
    if (j === -1) return s.trimEnd();
    const before = s.slice(0, j).replace(/\n---\s*$/, "").trimEnd();
    const afterMarker = s.slice(j);
    const end = afterMarker.indexOf("\n---\n");
    if (end === -1) return before;
    return (before + afterMarker.slice(end + "\n---\n".length)).trimEnd();
  }
  const before = s.slice(0, i).trimEnd();
  const rest = s.slice(i + MARKER_START.length);
  const end = rest.indexOf(MARKER_END);
  if (end === -1) return before;
  return (before + rest.slice(end + MARKER_END.length)).trimEnd();
}

function buildParamsMarkdown(ctx) {
  const lines = [];

  // Headers note
  if (ctx.needsAuth) {
    lines.push("**Header:** `Authorization: Bearer {{token}}` *(string JWT — from Login)*");
    lines.push("");
  }

  // Path placeholders in URL
  const pathParams = [...(ctx.url.matchAll(/\{\{(\w+)\}\}/g) || [])].map((m) => m[1]);
  const uniquePath = [...new Set(pathParams)].filter(
    (k) => !["baseUrl"].includes(k)
  );
  // Only document id-like path vars that appear after /api/
  const pathIdish = uniquePath.filter((k) =>
    /Id$|id$|token|masterId|roleId|userId|itemId/i.test(k)
  );
  if (pathIdish.length) {
    lines.push("**Path / URL variables**");
    for (const k of pathIdish) {
      lines.push(`- \`${k}\` → {{${k}}} — string (MongoId / id) | set collection variable after create/list`);
    }
    lines.push("");
  }

  if (ctx.query && ctx.query.length) {
    lines.push("**Query params** *(Params tab — each has description)*");
    for (const q of ctx.query) {
      if (!q.key) continue;
      const d = describeKey(q.key, ctx);
      lines.push(`- \`${q.key}\` — ${d}`);
    }
    lines.push("");
  }

  if (ctx.formdata && ctx.formdata.length) {
    lines.push("**Body (form-data)**");
    for (const f of ctx.formdata) {
      if (!f.key) continue;
      const d = describeKey(f.key, ctx);
      lines.push(`- \`${f.key}\` (${f.type || "text"}) — ${d}`);
    }
    lines.push("");
  }

  if (ctx.bodyKeys && ctx.bodyKeys.length) {
    lines.push("**Body (JSON raw)** — `Content-Type: application/json`");
    for (const { key, value } of ctx.bodyKeys) {
      if (!key) continue;
      let d = describeKey(key, ctx);
      // if generic, prepend inferred type
      if (d.startsWith("see sample")) {
        d = `${inferTypeFromValue(value)} | ${d}`;
      }
      lines.push(`- \`${key}\` — ${d}`);
    }
    lines.push("");
  }

  if (!lines.length) {
    lines.push("_No query/body params — path + Bearer token only (if secured)._");
    lines.push("");
  }

  lines.push(
    "_Tip: numbers/booleans/null in JSON must be unquoted (`28.6`, `true`, `null`). Dates = `YYYY-MM-DD`, times = `HH:mm`, month = `YYYY-MM`, ids = 24-char hex._"
  );

  return lines.join("\n");
}

function urlRaw(url) {
  if (!url) return "";
  if (typeof url === "string") return url;
  return url.raw || "";
}

function needsAuth(url, name) {
  const u = (url || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (n.includes("login") || n.includes("health") || n.includes("api root")) return false;
  if (u.includes("/api/auth/login") || u.endsWith("{{baseurl}}/") || u.includes("/api/health"))
    return false;
  return true;
}

function enrichRequest(item) {
  const r = item.request;
  if (!r || typeof r === "string") return;

  const url = urlRaw(r.url);
  const ctx = {
    name: item.name || "",
    url,
    needsAuth: needsAuth(url, item.name),
    query: (r.url && r.url.query) || [],
    formdata: [],
    bodyKeys: [],
  };

  // Query descriptions
  if (r.url && Array.isArray(r.url.query)) {
    for (const q of r.url.query) {
      if (!q || !q.key) continue;
      q.description = describeKey(q.key, ctx);
    }
  }

  // Form-data
  if (r.body && r.body.mode === "formdata" && Array.isArray(r.body.formdata)) {
    ctx.formdata = r.body.formdata;
    for (const f of r.body.formdata) {
      if (!f || !f.key) continue;
      f.description = describeKey(f.key, ctx);
    }
  }

  // Raw JSON body keys
  if (r.body && r.body.mode === "raw" && r.body.raw) {
    const parsed = parseRaw(r.body.raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const flat = flattenObj(parsed);
      // Prefer top-level + nested leaves; skip empty key
      ctx.bodyKeys = Object.entries(flat)
        .filter(([k]) => k && k !== "(root)")
        .map(([key, value]) => ({ key, value }));
    }
  }

  // urlencoded
  if (r.body && r.body.mode === "urlencoded" && Array.isArray(r.body.urlencoded)) {
    for (const f of r.body.urlencoded) {
      if (!f || !f.key) continue;
      f.description = describeKey(f.key, ctx);
    }
  }

  const baseDesc = stripOldParamsBlock(r.description || "");
  const block = buildParamsMarkdown(ctx);
  r.description = baseDesc + MARKER_START + block + MARKER_END;
}

function walk(items) {
  for (const it of items || []) {
    if (it.item) {
      walk(it.item);
      continue;
    }
    enrichRequest(it);
  }
}

const collection = JSON.parse(fs.readFileSync(COLLECTION, "utf8"));

// Collection-level tip
const tip =
  "\n\n**How to read params:** Each request → Docs / description has **Parameters (type + how to send)**. Query & form fields also show descriptions in the Params / Body tabs. JSON: unquoted numbers/booleans; dates `YYYY-MM-DD`; times `HH:mm`.";
if (!String(collection.info.description || "").includes("How to read params")) {
  collection.info.description = String(collection.info.description || "").trimEnd() + tip;
}

walk(collection.item);

fs.writeFileSync(COLLECTION, JSON.stringify(collection, null, 2) + "\n", "utf8");
console.log("Updated:", COLLECTION);

// quick stats
let reqs = 0;
let qDesc = 0;
let qTotal = 0;
function stats(items) {
  for (const it of items || []) {
    if (it.item) {
      stats(it.item);
      continue;
    }
    reqs++;
    const q = (it.request && it.request.url && it.request.url.query) || [];
    for (const x of q) {
      qTotal++;
      if (x.description) qDesc++;
    }
  }
}
stats(collection.item);
console.log({ requests: reqs, queryParams: qTotal, queryWithDesc: qDesc });
