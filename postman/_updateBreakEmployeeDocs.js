/**
 * Refresh Employee 2.6 Break + Admin day-request Postman items.
 * Run: node postman/_updateBreakEmployeeDocs.js
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

const saveBreakId = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const j = pm.response.json();",
        "const id = (j.break && (j.break._id)) || j._id;",
        "if (id) pm.collectionVariables.set('breakId', id);",
        "const reqId = j.request && j.request._id;",
        "if (reqId) pm.collectionVariables.set('dayBreakRequestId', reqId);",
      ],
    },
  },
];

const saveDayReqId = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const j = pm.response.json();",
        "const id = (j.request && j.request._id) || (j.data && j.data[0] && j.data[0]._id);",
        "if (id) pm.collectionVariables.set('dayBreakRequestId', id);",
      ],
    },
  },
];

const employeeBreakFolder = {
  name: "2.6 Break",
  description: [
    "## Employee Break (auto + policy minutes)",
    "Login Employee (2.1) → Punch In (2.2) → these.",
    "",
    "### Dynamic policies",
    "Fixed breaks (Lunch, Tea, …) use **current published policy minutes**.",
    "Example: Lunch policy 30 → later 45 → remaining = 45 − used today.",
    "",
    "### Auto start (no breakType)",
    "`POST /start` with empty body `{}` picks next fixed policy with remainingMinutes > 0",
    "(Lunch → Tea → …). When fixed remaining is 0 → Day Break only after RM/HR approval.",
    "",
    "### Day Break",
    "1. `POST /day-request` `{ minutes: 10 }` (after fixed used)",
    "2. Manager: `POST /day-request/:id/review` approve",
    "3. Employee: `POST /start` again → starts Day Break with approved minutes",
  ].join("\n"),
  item: [
    {
      name: "1. My Break Today",
      request: {
        method: "GET",
        header: [],
        url: urlOf("{{baseUrl}}/api/break/me"),
        description: [
          "GET /api/break/me",
          "",
          "**policies[]** (from published policies):",
          "- Fixed: `minutes`, `usedMinutes`, `remainingMinutes` (live from policy)",
          "- Day Break: `flexible`, `needsApproval`, `canStart`, `approvedMinutes`, `pendingRequest`",
          "",
          "**nextBreak** — what `POST /start` will pick next.",
          "",
          "**todayTime** — ACTIVE / IDLE / BREAK:",
          "- `active` / `idle` / `break`: `{ minutes, clock: HH:mm:ss, label }`",
          "- `status`: Working | On Break | Clocked Out | Not Clocked In",
          "",
          "Header: `Authorization: Bearer {{token}}`",
        ].join("\n"),
      },
    },
    {
      name: "2. Start Break (auto next)",
      request: {
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: urlOf("{{baseUrl}}/api/break/start"),
        description: [
          "POST /api/break/start — **no breakType needed**.",
          "",
          "**Body:** `latitude` + `longitude` required (within **50 m** of branch office).",
          "Auto order: next fixed with remaining → then Day Break if granted.",
          "Punch in first. One open break at a time. Saves {{breakId}}.",
        ].join("\n"),
        body: {
          mode: "raw",
          raw: JSON.stringify(
            { latitude: 28.6294351, longitude: 77.2222984 },
            null,
            2
          ),
          options: { raw: { language: "json" } },
        },
      },
      event: saveBreakId,
    },
    {
      name: "3. Request Day Break",
      request: {
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: urlOf("{{baseUrl}}/api/break/day-request"),
        description: [
          "POST /api/break/day-request",
          "Only after Lunch/Tea (all fixed) remaining is 0.",
          "",
          "Body: `{ \"minutes\": 10 }` — time you want RM/HR to approve.",
          "Then manager approves → you can `POST /start`.",
          "Saves {{dayBreakRequestId}}.",
        ].join("\n"),
        body: {
          mode: "raw",
          raw: JSON.stringify({ minutes: 10 }, null, 2),
          options: { raw: { language: "json" } },
        },
      },
      event: saveDayReqId,
    },
    {
      name: "4. End My Break",
      request: {
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: urlOf("{{baseUrl}}/api/break/end"),
        description: [
          "POST /api/break/end",
          "**Body:** `latitude` + `longitude` required (within **50 m** of branch).",
          "Response: break minutes + attendance worked / required / remaining.",
        ].join("\n"),
        body: {
          mode: "raw",
          raw: JSON.stringify(
            { latitude: 28.6294351, longitude: 77.2222984 },
            null,
            2
          ),
          options: { raw: { language: "json" } },
        },
      },
    },
  ],
};

const dayRequestAdminItems = [
  {
    name: "3b. Day Break Requests",
    request: {
      method: "GET",
      header: [],
      url: urlOf("{{baseUrl}}/api/break/day-requests?status=Pending&page=1&limit=20", [
        { key: "status", value: "Pending", description: "Pending | Approved | Rejected | Used | ALL" },
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ]),
      description: [
        "GET /api/break/day-requests",
        "RM / HR / Admin queue — employee asked for Day Break minutes.",
        "Saves first `_id` → {{dayBreakRequestId}}.",
      ].join("\n"),
    },
    event: saveDayReqId,
  },
  {
    name: "3c. Review Day Break Request",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      url: urlOf("{{baseUrl}}/api/break/day-request/{{dayBreakRequestId}}/review"),
      description: [
        "POST /api/break/day-request/{{dayBreakRequestId}}/review",
        "Body: decision approve | reject.",
        "Approve → employee can POST /api/break/start (auto Day Break with those minutes).",
      ].join("\n"),
      body: {
        mode: "raw",
        raw: JSON.stringify(
          { decision: "approve", remarks: "Ok for 10 minutes" },
          null,
          2
        ),
        options: { raw: { language: "json" } },
      },
    },
  },
];

function walk(items, fn) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    fn(item);
    if (item.item) walk(item.item, fn);
  }
}

walk(c.item, (item) => {
  if (item.name === "2.6 Break" && item.item) {
    item.description = employeeBreakFolder.description;
    item.item = employeeBreakFolder.item;
  }
  if (item.name === "1.10 Break" && item.item) {
    item.description = [
      "Live Break Status, overage approvals, Day Break grants, Break History.",
      "Login Super Admin / Admin / HR / Reporting Manager.",
      "",
      "Fixed policy minutes are dynamic (e.g. Lunch 30 or 45) — remaining = policy − used today.",
      "Day Break: employee requests minutes → review here → then they can start.",
    ].join("\n");
    const has3b = item.item.some((x) => x.name && x.name.startsWith("3b."));
    if (!has3b) {
      const idx = item.item.findIndex((x) => x.name && x.name.startsWith("3."));
      const at = idx >= 0 ? idx + 1 : item.item.length;
      item.item.splice(at, 0, ...dayRequestAdminItems);
    }
  }
});

// collection variable
if (!c.variable.some((v) => v.key === "dayBreakRequestId")) {
  c.variable.push({ key: "dayBreakRequestId", value: "" });
}

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("Updated 2.6 Break + 1.10 Day Break request items");
