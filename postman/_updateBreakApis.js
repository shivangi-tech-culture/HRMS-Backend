/**
 * Add Break APIs to HRMS_API.postman_collection.json
 * Run: node postman/_updateBreakApis.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const collection = JSON.parse(fs.readFileSync(file, "utf8"));

const urlOf = (raw, query) => {
  const u = {
    raw,
    host: ["{{baseUrl}}"],
    path: raw.replace("{{baseUrl}}/", "").split("?")[0].split("/").filter(Boolean),
  };
  if (query) u.query = query;
  return u;
};

const q = (key, value, description, disabled) => {
  const row = { key, value, description };
  if (disabled) row.disabled = true;
  return row;
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

const postJson = (name, raw, description, body, testLines) => {
  const item = {
    name,
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: urlOf(raw),
      description,
      body: {
        mode: "raw",
        raw: JSON.stringify(body, null, 2),
        options: { raw: { language: "json" } },
      },
    },
  };
  if (testLines) {
    item.event = [
      {
        listen: "test",
        script: { type: "text/javascript", exec: testLines },
      },
    ];
  }
  return item;
};

const reqJson = (name, method, raw, description, body) => ({
  name,
  request: {
    method,
    header: [{ key: "Content-Type", value: "application/json" }],
    url: urlOf(raw),
    description,
    body: {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    },
  },
});

const postEmpty = (name, raw, description, testLines) => {
  const item = {
    name,
    request: {
      method: "POST",
      header: [],
      url: urlOf(raw),
      description,
    },
  };
  if (testLines) {
    item.event = [
      {
        listen: "test",
        script: { type: "text/javascript", exec: testLines },
      },
    ];
  }
  return item;
};

const saveBreakId = [
  "const j = pm.response.json();",
  "const id = (j.break && j.break._id) || j._id;",
  "if (id) pm.collectionVariables.set('breakId', id);",
];

const saveLiveBreakId = [
  "const j = pm.response.json();",
  "const row = (j.data || []).find((r) => r._id);",
  "if (row) pm.collectionVariables.set('breakId', row._id);",
];

const adminBreak = {
  name: "1.10 Break",
  description:
    "Live Break Status, approvals, and Break History.\nLogin as Super Admin / Admin / HR / Reporting Manager (0. Login).\nDaily balance is 30 minutes (policy). Unused minutes stay and can be split later, for example 10 then 10 then 10.\nA break that ends past the remaining balance is Pending. Reporting manager approves or rejects it.\nRejected minutes go back into the balance. History keeps every closed break.\nStored status: On Break, Overdue, Completed, Pending, Approved, Rejected.\nAt Desk is only on the live list.",
  item: [
    getReq(
      "1. Live Break Status",
      "{{baseUrl}}/api/break/live?status=all&page={{page}}&limit={{limit}}",
      "GET /api/break/live\nPeople punched in today.\nstatus filter: all | on_break | at_desk | overdue\ncounts: all, onBreak, atDesk, overdue\nEach row includes stored status, splits (count and minutes per break type), and taken (every break today). First open break _id is saved as {{breakId}}.\n\n---\n### Parameters\n**Header:** `Authorization: Bearer {{token}}`\n- `search` — name or employee code\n- `department` — exact department, or ALL\n- `shiftId` — shift master id, or ALL\n- `status` — all | on_break | at_desk | overdue\n- `companyId` — optional\n- `page` / `limit`\n",
      [
        q("search", "", "string | optional | employee name or code", true),
        q("department", "ALL", "string | optional | department name, or ALL", true),
        q("shiftId", "{{shiftId}}", "string (MongoId) | optional | shift id, or ALL", true),
        q("status", "all", "string | optional | all, on_break, at_desk, overdue"),
        q("companyId", "{{companyId}}", "string (MongoId) | optional", true),
        q("page", "{{page}}", "number | optional | default 1"),
        q("limit", "{{limit}}", "number | optional | default 10, max 100"),
      ]
    ),
    getReq(
      "2. Break History",
      "{{baseUrl}}/api/break/history?page={{page}}&limit={{limit}}",
      "GET /api/break/history\nClosed breaks only.\nstatus: all | completed | pending | approved | rejected\nbreakType: Lunch Break | Day Break\n\n---\n### Parameters\n**Header:** `Authorization: Bearer {{token}}`\n- `search` — name or employee code\n- `department` — exact department\n- `shiftId` — shift master id\n- `breakType` — Lunch Break or Day Break\n- `status` — all | completed | pending | approved | rejected\n- `from` / `to` — YYYY-MM-DD\n- `page` / `limit`\n",
      [
        q("search", "", "string | optional | employee name or code", true),
        q("department", "", "string | optional | department name", true),
        q("shiftId", "{{shiftId}}", "string (MongoId) | optional", true),
        q("breakType", "Lunch Break", "string | optional | Lunch Break or Day Break", true),
        q("status", "all", "string | optional | all, completed, pending, approved, rejected"),
        q("from", "2026-10-01", "string (YYYY-MM-DD) | optional", true),
        q("to", "2026-10-31", "string (YYYY-MM-DD) | optional", true),
        q("page", "{{page}}", "number | optional | default 1"),
        q("limit", "{{limit}}", "number | optional | default 10, max 100"),
      ]
    ),
    getReq(
      "3. Pending Approvals",
      "{{baseUrl}}/api/break/approvals?page={{page}}&limit={{limit}}",
      "GET /api/break/approvals\nBreaks that ended past today's balance and still need the reporting manager.\nLogin as that person's reporting manager, HR, or admin.\n\n---\n### Parameters\n**Header:** `Authorization: Bearer {{token}}`\n- `search` / `from` / `to` / `page` / `limit`\n",
      [
        q("search", "", "string | optional | employee name or code", true),
        q("from", "2026-10-01", "string (YYYY-MM-DD) | optional", true),
        q("to", "2026-10-31", "string (YYYY-MM-DD) | optional", true),
        q("page", "{{page}}", "number | optional | default 1"),
        q("limit", "{{limit}}", "number | optional | default 10, max 100"),
      ]
    ),
    postJson(
      "4. Review Break",
      "{{baseUrl}}/api/break/{{breakId}}/review",
      "POST /api/break/:id/review\nReporting manager decision on a Pending break.\ndecision = approve keeps the minutes.\ndecision = reject puts those minutes back.\n{{breakId}} is the pending break id.",
      { decision: "approve", remarks: "" }
    ),
    getReq(
      "5. List Policies",
      "{{baseUrl}}/api/break/policies",
      "GET /api/break/policies\nAll policies. Employees never see this list.\nThey only see policies with published = true, and only 2 can be published.\nLunch Break is fixed minutes. Day Break is flexible (5 or 10) with no daily count.\nSaves {{policyId}} from the Day Break row.\n"
    ),
    postJson(
      "6. Create Policy",
      "{{baseUrl}}/api/break/policies",
      "POST /api/break/policies\nSaves a policy as unpublished.\nSet published true or false later on 7. Update Policy.\nflexible true = employee sends minutes (5 or 10) and there is no daily count.\nflexible false = minutes is the fixed allowance, like lunch.",
      { name: "Tea Break", flexible: false, minutes: 15, description: "" },
      [
        "const j = pm.response.json();",
        "if (j.policy && j.policy._id) pm.collectionVariables.set('policyId', j.policy._id);",
      ]
    ),
    reqJson(
      "7. Update Policy",
      "PUT",
      "{{baseUrl}}/api/break/policies/{{policyId}}",
      "PUT /api/break/policies/:id\nChange the name, minutes, or published.\npublished true shows it to employees. published false hides it.\nAny number of policies can be published.\n{{policyId}} comes from 6. Create Policy or 5. List Policies.",
      { name: "Tea Break", flexible: false, minutes: 10, description: "", published: true }
    ),
    {
      name: "8. Delete Policy",
      request: {
        method: "DELETE",
        header: [],
        url: urlOf("{{baseUrl}}/api/break/policies/{{policyId}}"),
        description:
          "DELETE /api/break/policies/:id\nSet published to false on Update Policy first. A published policy cannot be deleted.",
      },
    },
  ],
};

adminBreak.item[0].event = [
  {
    listen: "test",
    script: { type: "text/javascript", exec: saveLiveBreakId },
  },
];
adminBreak.item[4].event = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const j = pm.response.json();",
        "const row = (j.data || []).find((r) => r.flexible) || (j.data || [])[0];",
        "if (row && row._id) pm.collectionVariables.set('policyId', row._id);",
      ],
    },
  },
];

const employeeBreak = {
  name: "2.6 Break",
  description:
    "Employee start / end. Run 2.1 Login (Employee), then 2.2 Punch In, then these.\nGET /me returns only the 2 published policies.\nLunch Break uses the policy minutes. Day Break needs minutes (5 or 10) and has no daily count.\nUnpublished policies are hidden. Ending past the allowed minutes saves Pending.",
  item: [
    getReq(
      "1. My Break Today",
      "{{baseUrl}}/api/break/me",
      "GET /api/break/me\nEmployee view. policies has the 2 published breaks only.\nLunch includes minutes and remainingMinutes. Day Break is flexible: true.\ntoday.splits is how many times each break was taken today.\nhistory lists every day, including previous days, with each break.\n\n---\n### Parameters\n**Header:** `Authorization: Bearer {{token}}` from 2.1 Login (Employee)\n"
    ),
    postJson(
      "2. Start Lunch Break",
      "{{baseUrl}}/api/break/start",
      "POST /api/break/start\nBody breakType = Lunch Break.\nUses today's remaining balance. Punch in first. One open break at a time.\nSaves {{breakId}}.",
      { breakType: "Lunch Break" },
      saveBreakId
    ),
    postJson(
      "3. Start Day Break",
      "{{baseUrl}}/api/break/start",
      "POST /api/break/start\nBody breakType = Day Break and minutes = 10 (or 5).\nNo daily count. Ending after those minutes needs reporting manager approval.\nSaves {{breakId}}.",
      { breakType: "Day Break", minutes: 10 },
      saveBreakId
    ),
    postEmpty(
      "4. End My Break",
      "{{baseUrl}}/api/break/end",
      "POST /api/break/end\nOnly the employee can end the break.\nResponse includes this break's minutes and attendance:\nworked, required (9h from the shift), remaining, completed.\nBreak time is removed from working hours."
    ),
  ],
};

const admin = collection.item.find((folder) => folder.name && folder.name.includes("ADMIN"));
const employee = collection.item.find((folder) => folder.name && folder.name.includes("EMPLOYEE"));
if (!admin || !employee) throw new Error("Admin or Employee folder missing");

const replaceFolder = (parent, name, folder) => {
  const index = parent.item.findIndex((item) => item.name === name);
  if (index >= 0) parent.item.splice(index, 1, folder);
  else parent.item.push(folder);
};

replaceFolder(admin, "1.10 Break", adminBreak);
replaceFolder(employee, "2.6 Break", employeeBreak);

if (!collection.variable.some((row) => row.key === "breakId")) {
  collection.variable.push({ key: "breakId", value: "" });
}
if (!collection.variable.some((row) => row.key === "policyId")) {
  collection.variable.push({ key: "policyId", value: "" });
}

fs.writeFileSync(file, JSON.stringify(collection, null, 2) + "\n");
console.log("Break requests added: 1.10 Break and 2.6 Break");
