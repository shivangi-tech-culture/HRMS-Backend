/**
 * One-shot: add/update Attendance APIs in HRMS_API.postman_collection.json
 * Run: node postman/_updateAttendanceApis.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

const urlOf = (raw, query) => {
  const u = {
    raw,
    host: ["{{baseUrl}}"],
    path: raw
      .replace("{{baseUrl}}/", "")
      .split("?")[0]
      .split("/")
      .filter(Boolean),
  };
  if (query) u.query = query;
  return u;
};

const getReq = (name, raw, description, query) => ({
  name,
  request: {
    method: "GET",
    header: [],
    url: urlOf(raw, query),
    description,
  },
});

const postJson = (name, raw, description, bodyObj, events, query) => {
  const item = {
    name,
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: urlOf(raw, query),
      description,
      body: {
        mode: "raw",
        raw: JSON.stringify(bodyObj, null, 2),
        options: { raw: { language: "json" } },
      },
    },
  };
  if (events) item.event = events;
  return item;
};

const postEmpty = (name, raw, description) => ({
  name,
  request: {
    method: "POST",
    header: [],
    url: urlOf(raw),
    description,
  },
});

const saveAttendanceId = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const j = pm.response.json();",
        "const id = (j.record && j.record._id) || j._id;",
        "if (id) pm.collectionVariables.set('attendanceId', id);",
      ],
    },
  },
];

// ── ESS punch folder ─────────────────────────────────────────
const ess = c.item.find((i) => i.name && i.name.includes("EMPLOYEE"));
const punchFolder = ess.item.find((i) => i.name && i.name.includes("Attendance"));
punchFolder.description =
  "Employee self punch. Response includes company, branch, shift, remarks/reason (same field), overtime after punch-out.\nLogin as Employee first (2.1 → 1).";

punchFolder.item = [
  postJson(
    "1. Punch In",
    "{{baseUrl}}/api/attendance/punch-in",
    "Punch in. Returns company + branch + shift + remarks.\n\n**Body:** `source` (web|mobile|biometric), `latitude`, `longitude`, optional `remarks` or `reason` (same field).",
    {
      source: "web",
      latitude: 28.6301,
      longitude: 77.2242,
      remarks: "Reached office",
    },
    saveAttendanceId
  ),
  postJson(
    "2. Punch Out",
    "{{baseUrl}}/api/attendance/punch-out",
    "Punch out. Computes Present/HalfDay, late/early, overtime (over 9h). If remarks pending → status stays Pending for admin approve/reject.",
    {
      source: "web",
      latitude: 28.6301,
      longitude: 77.2242,
      remarks: "",
    },
    saveAttendanceId
  ),
  getReq(
    "3. My Today",
    "{{baseUrl}}/api/attendance/today",
    "Today's record + company / branch / shift."
  ),
  getReq(
    "4. My Punches",
    "{{baseUrl}}/api/attendance/web-punches?from={{fromDate}}&to={{toDate}}&page={{page}}&limit={{limit}}",
    "Own IN/OUT punch rows.",
    [
      { key: "from", value: "{{fromDate}}" },
      { key: "to", value: "{{toDate}}" },
      {
        key: "date",
        value: "{{attendanceDate}}",
        disabled: true,
        description: "YYYY-MM-DD single day",
      },
      { key: "status", value: "ALL", disabled: true },
      { key: "page", value: "{{page}}" },
      { key: "limit", value: "{{limit}}" },
    ]
  ),
];

// ── Admin Attendance folder ──────────────────────────────────
const admin = c.item.find((i) => i.name && i.name.startsWith("1. ADMIN"));
admin.item = admin.item.filter((i) => !String(i.name).includes("Attendance"));

const adminAttendance = {
  name: "1.7 Attendance",
  description:
    "Daily list · calendar · late/early · remark approve/reject.\nScope: Super Admin/Admin = all · HR = assigned companies · Manager = team.\nDoes NOT change company/employee assignment.\nLogin as Super Admin / Admin / HR / Manager first.",
  item: [
    {
      name: "1. Daily Attendance",
      item: [
        getReq(
          "1. List Daily (today / date)",
          "{{baseUrl}}/api/attendance/daily?date={{attendanceDate}}&page={{page}}&limit={{limit}}",
          "Date-wise employee attendance. Includes company, branch, shift, workingHours, overtime, remarks, canApproveReject.",
          [
            {
              key: "date",
              value: "{{attendanceDate}}",
              description: "YYYY-MM-DD (default today)",
            },
            {
              key: "search",
              value: "",
              disabled: true,
              description: "name / emp code",
            },
            { key: "department", value: "", disabled: true },
            { key: "branchId", value: "{{branchId}}", disabled: true },
            { key: "shiftId", value: "{{shiftId}}", disabled: true },
            { key: "companyId", value: "{{companyId}}", disabled: true },
            {
              key: "workMode",
              value: "ALL",
              disabled: true,
              description: "WFO|WFH|Hybrid|ALL",
            },
            { key: "status", value: "ALL", disabled: true },
            { key: "hasRemark", value: "true", disabled: true },
            { key: "attendanceStatus", value: "Late", disabled: true },
            { key: "page", value: "{{page}}" },
            { key: "limit", value: "{{limit}}" },
          ]
        ),
        {
          ...getReq(
            "2. List Daily (pending remarks → save id)",
            "{{baseUrl}}/api/attendance/daily?date={{attendanceDate}}&hasRemark=true&attendanceStatus=Late&page=1&limit=20",
            "Pending remarks — test script saves first row `_id` → {{attendanceId}}.",
            [
              { key: "date", value: "{{attendanceDate}}" },
              { key: "hasRemark", value: "true" },
              { key: "attendanceStatus", value: "Late" },
              { key: "page", value: "1" },
              { key: "limit", value: "20" },
            ]
          ),
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "const j = pm.response.json();",
                  "const row = (j.data || []).find(r => r._id) || (j.data || [])[0];",
                  "if (row && row._id) pm.collectionVariables.set('attendanceId', row._id);",
                ],
              },
            },
          ],
        },
        postJson(
          "3. Approve",
          "{{baseUrl}}/api/attendance/{{attendanceId}}/review?decision=approve",
          "Same API as Reject. Query decision=approve. Body { reason }. Only Late. Day stays Present. attendanceStatus becomes Approved.",
          { reason: "Checked punch time. Approved." },
          null,
          [{ key: "decision", value: "approve", description: "approve or reject. Same API." }]
        ),
        postJson(
          "4. Reject",
          "{{baseUrl}}/api/attendance/{{attendanceId}}/review?decision=reject",
          "Same API as Approve. Query decision=reject. Body { reason }. Only Late. Day stays Present. attendanceStatus becomes Rejected.",
          { reason: "Punch time is too late. Rejected." },
          null,
          [{ key: "decision", value: "reject", description: "approve or reject. Same API." }]
        ),
      ],
    },
    {
      name: "2. Attendance Calendar",
      item: [
        getReq(
          "1. Calendar by month",
          "{{baseUrl}}/api/attendance/calendar?month={{attendanceMonth}}",
          "All days in month with present/absent/late/WFH/pendingRemarks counts.",
          [
            {
              key: "month",
              value: "{{attendanceMonth}}",
              description: "YYYY-MM",
            },
            { key: "companyId", value: "{{companyId}}", disabled: true },
            { key: "department", value: "", disabled: true },
            { key: "branchId", value: "{{branchId}}", disabled: true },
          ]
        ),
        getReq(
          "2. Calendar by from–to",
          "{{baseUrl}}/api/attendance/calendar?from={{fromDate}}&to={{toDate}}",
          "Custom date range day summaries.",
          [
            { key: "from", value: "{{fromDate}}" },
            { key: "to", value: "{{toDate}}" },
          ]
        ),
      ],
    },
    {
      name: "3. Late & Early Departures",
      item: [
        getReq(
          "1. Late Arrivals",
          "{{baseUrl}}/api/attendance/late-early?type=late&date={{attendanceDate}}&page=1&limit=10",
          "Late Arrivals tab. Use `counts.late` / `counts.early` for badges.",
          [
            {
              key: "type",
              value: "late",
              description: "late | early | all",
            },
            { key: "date", value: "{{attendanceDate}}" },
            { key: "search", value: "", disabled: true },
            { key: "department", value: "", disabled: true },
            { key: "shiftId", value: "{{shiftId}}", disabled: true },
            { key: "companyId", value: "{{companyId}}", disabled: true },
            { key: "page", value: "1" },
            { key: "limit", value: "10" },
          ]
        ),
        {
          ...getReq(
            "2. Early Departures",
            "{{baseUrl}}/api/attendance/late-early?type=early&date={{attendanceDate}}&page=1&limit=10",
            "Early Departures tab. Saves first `_id` → {{attendanceId}}.",
            [
              { key: "type", value: "early" },
              { key: "date", value: "{{attendanceDate}}" },
              { key: "page", value: "1" },
              { key: "limit", value: "10" },
            ]
          ),
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "const j = pm.response.json();",
                  "const row = (j.data || [])[0];",
                  "if (row && row._id) pm.collectionVariables.set('attendanceId', row._id);",
                ],
              },
            },
          ],
        },
        getReq(
          "2. Detail",
          "{{baseUrl}}/api/attendance/late-early/{{attendanceId}}",
          "One attendance row. Same isLate / isEarly numbers as the list, plus punch, timeline, and shift summary."
        ),
      ],
    },
  ],
};

admin.item.push(adminAttendance);

// ── Variables ────────────────────────────────────────────────
const ensureVar = (key, value) => {
  const list = c.variable || (c.variable = []);
  const existing = list.find((v) => v.key === key);
  if (existing) {
    if (
      value != null &&
      value !== "" &&
      (existing.value == null || existing.value === "")
    ) {
      existing.value = value;
    } else if (value != null && value !== "") {
      // keep existing non-empty; still refresh date helpers if blank-ish
      if (
        (key === "attendanceDate" ||
          key === "attendanceMonth" ||
          key === "fromDate" ||
          key === "toDate") &&
        !String(existing.value || "").trim()
      ) {
        existing.value = value;
      }
    }
  } else {
    list.push({ key, value: value == null ? "" : String(value) });
  }
};

ensureVar("attendanceId", "");
ensureVar("attendanceDate", "2026-10-07");
ensureVar("attendanceMonth", "2026-10");
ensureVar("fromDate", "2026-10-01");
ensureVar("toDate", "2026-10-31");

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");

console.log("Updated:", file);
console.log(
  "Admin:",
  admin.item.map((i) => i.name).join(" | ")
);
console.log(
  "1.7:",
  adminAttendance.item
    .map((i) => `${i.name} (${i.item.length})`)
    .join(", ")
);
console.log(
  "ESS punch:",
  punchFolder.item.map((i) => i.name).join(", ")
);
