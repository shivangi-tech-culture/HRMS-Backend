/**
 * Add Profile Completion API requests to Postman collection.
 * Run: node postman/_updateProfileCompletionDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

const AUTH_HEADER =
  "Authorization: Bearer {{token}} *(string JWT — from Login)*";
const TIP =
  "_Tip: numbers/booleans/null in JSON must be unquoted (`28.6`, `true`, `null`). Dates = `YYYY-MM-DD`, times = `HH:mm`, month = `YYYY-MM`, ids = 24-char hex._";

const OWN_DOC = [
  "## GET `/api/account/profile/completion`",
  "Own profile completion for **any role** (Employee, HR Manager, Reporting Manager, Admin).",
  "",
  "### What you get",
  "- `percentage` — overall % (filled ÷ total checklist fields)",
  "- `filledFields` / `remainingFields` / `totalFields`",
  "- `mandatory` — total, filled, remaining, `missing[]` (must-fill fields left)",
  "- `optional` — same for non-mandatory fields",
  "- `sections[]` — Account / Personal / Official / Education / Bank / Family / … with per-section %",
  "",
  "### Mandatory fields (standard)",
  "name, DOB, Aadhaar, PAN, gender, mobile, official email, company, department, designation, date of joining.",
  "",
  "### Who",
  "Any logged-in user — always **own** profile.",
  "",
  "---",
  "### Parameters (type + how to send)",
  `**Header:** \`${AUTH_HEADER}\``,
  "",
  TIP,
  "---",
].join("\n");

const EMP_DOC = [
  "## GET `/api/employees/{{employeeId}}/profile-completion`",
  "Same completion payload for a chosen employee (or `me`).",
  "",
  "### Who",
  "- **Employee** — own id / `me` only",
  "- **HR Manager** — assigned companies",
  "- **Reporting Manager** — own team",
  "- **Super Admin / Admin** — any",
  "",
  "### Response",
  "Same shape as `GET /api/account/profile/completion`:",
  "`percentage`, filled/remaining counts, `mandatory.missing`, `sections[]`.",
  "",
  "---",
  "### Parameters (type + how to send)",
  `**Header:** \`${AUTH_HEADER}\``,
  "",
  "**Path / URL variables**",
  "- `employeeId` → {{employeeId}} — string (MongoId 24-hex) | whose profile. Use `me` for self.",
  "",
  TIP,
  "---",
].join("\n");

const ESS_DOC = [
  "## GET `/api/employees/me/profile-completion`",
  "Own profile completion after **Employee** login (same as account endpoint).",
  "",
  "Shows % complete, how many mandatory fields are left, and section-wise gaps.",
  "",
  "Needs **Self → General Info → view**.",
  "",
  "---",
  "### Parameters (type + how to send)",
  `**Header:** \`Authorization: Bearer {{token}}\` *(Employee login)*`,
  "",
  "No query and no body. Path is fixed: `/api/employees/me/profile-completion`.",
  "---",
].join("\n");

function getRequest(name, method, rawUrl, pathParts, description) {
  return {
    name,
    request: {
      method,
      header: [],
      url: {
        raw: rawUrl,
        host: ["{{baseUrl}}"],
        path: pathParts,
      },
      description,
    },
    response: [],
  };
}

function findItem(items, name) {
  return (items || []).find((i) => i.name === name);
}

function insertAfter(items, afterName, newItem) {
  if (!items) return false;
  if (items.some((i) => i.name === newItem.name)) return false;
  const idx = items.findIndex((i) => i.name === afterName);
  if (idx < 0) return false;
  items.splice(idx + 1, 0, newItem);
  return true;
}

// 0. Login & My Account → after "2. Get My Account"
const loginFolder = findItem(c.item, "0. Login & My Account");
if (loginFolder?.item) {
  insertAfter(
    loginFolder.item,
    "2. Get My Account",
    getRequest(
      "2b. My Profile Completion %",
      "GET",
      "{{baseUrl}}/api/account/profile/completion",
      ["api", "account", "profile", "completion"],
      OWN_DOC
    )
  );
}

// 1.5 Employees → after "3b. Get Employee ID Card"
function walk(items, fn) {
  for (const it of items || []) {
    fn(it);
    if (it.item) walk(it.item, fn);
  }
}

walk(c.item, (it) => {
  if (it.name === "1.5 Employees" || it.name === "Employees" || (it.item && it.name.includes("Employees"))) {
    // try insert in this folder's direct children
    if (it.item) {
      insertAfter(
        it.item,
        "3b. Get Employee ID Card",
        getRequest(
          "3c. Get Profile Completion %",
          "GET",
          "{{baseUrl}}/api/employees/{{employeeId}}/profile-completion",
          ["api", "employees", "{{employeeId}}", "profile-completion"],
          EMP_DOC
        )
      );
    }
  }
  // ESS: 2.1 My Profile → APIs → after ID card
  if (it.name === "APIs" && it.item?.some((x) => x.name === "2b. Get My ID Card")) {
    insertAfter(
      it.item,
      "2b. Get My ID Card",
      getRequest(
        "2c. My Profile Completion %",
        "GET",
        "{{baseUrl}}/api/employees/me/profile-completion",
        ["api", "employees", "me", "profile-completion"],
        ESS_DOC
      )
    );
  }
});

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("Updated Postman collection with Profile Completion APIs");
