/**
 * Sync Postman docs with current FCM + punch-in behaviour.
 * Login: username + password only. FCM via POST /api/notifications/token.
 * Run: node postman/_updateNotificationDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

const AUTH =
  "**Header:** `Authorization: Bearer {{token}}` *(JWT from Login)*";
const TIP =
  "_Tip: numbers/booleans/null unquoted. Dates `YYYY-MM-DD`. ids = 24-char hex._";

const LOGIN_BODY_BLOCK = [
  "### Body fields",
  "| Field | Required | Use |",
  "|-------|----------|-----|",
  "| `username` | yes | email / employee code / mobile |",
  "| `password` | yes | login password |",
  "",
  "### What returns",
  "- Response = **JWT** (`token`, user, …).",
  "",
  "### FCM (push)",
  "Not on login. After login call `POST /api/notifications/token` with `token`, `platform`, `deviceId`.",
].join("\n");

const PUNCH_IN_DOC = [
  "## POST `/api/attendance/punch-in`",
  "Start the work day. GPS must be **within 50 m** of the assigned branch office.",
  "",
  "### Profile gate (70%) — error shape",
  "If profile **&lt; 70%** → HTTP **`403`**:",
  "",
  "```json",
  "{",
  '  "success": false,',
  '  "message": "Profile 45% (need 70%). Complete: …. Punch-in blocked.",',
  '  "code": "PROFILE_INCOMPLETE",',
  '  "percentage": 45,',
  '  "needPercentage": 70,',
  '  "completeThese": [',
  '    { "key": "personal.mobileNo", "label": "Mobile number", "section": "personal" }',
  "  ]",
  "}",
  "```",
  "",
  "Also creates/updates `PROFILE_COMPLETION` notification + **FCM push** if device token was registered via `POST /api/notifications/token`.",
  "",
  "### Body",
  "| Field | Type | Required |",
  "|-------|------|----------|",
  "| `source` | string | yes (`web`\\|`mobile`\\|`biometric`) |",
  "| `latitude` | number | yes |",
  "| `longitude` | number | yes |",
  "| `remarks` | string | no |",
  "",
  "### Geofence",
  "Within 50 m of branch GPS. Sample Kailash: `28.6294351, 77.2222984`.",
  "",
  "---",
  AUTH,
  "",
  TIP,
  "---",
].join("\n");

const REGISTER_DOC = [
  "## POST `/api/notifications/token`",
  "Register / refresh FCM device token **after login**.",
  "",
  "Saves on `User.fcmTokens[]` (max 10). Same `deviceId` replaces previous row.",
  "Call again when Firebase refreshes the token while still logged in.",
  "",
  "### Body",
  "| Field | Required |",
  "|-------|----------|",
  "| `token` | yes |",
  "| `platform` | no (`web`\\|`android`\\|`ios`) |",
  "| `deviceId` | no |",
  "",
  "---",
  AUTH,
  "",
  TIP,
  "---",
].join("\n");

const LIST_DOC_ADMIN = [
  "## GET `/api/notifications`",
  "Bell / admin list. Saves `{{notificationId}}` from first row.",
  "",
  "| Role | Sees |",
  "|------|------|",
  "| Employee | Own |",
  "| Reporting Manager | Self + team |",
  "| HR | Assigned companies |",
  "| Super Admin / Admin | All |",
  "",
  "`?userId=` only if in scope (else 403).",
  "",
  "---",
  AUTH,
  "",
  TIP,
  "---",
].join("\n");

const LIST_DOC_EMP = [
  "## GET `/api/notifications` — Employee (own only)",
  "Bell list. After blocked punch-in see `type: PROFILE_COMPLETION`.",
  "",
  "---",
  AUTH,
  "---",
].join("\n");

const MARK_DOC = [
  "## PUT `/api/notifications/:id/read`",
  "Own OK. Admin/HR/RM only if notification user is in company/team scope.",
  "",
  "---",
  AUTH,
  "",
  "**Path:** `{{notificationId}}`",
  "---",
].join("\n");

const COMPLETION_OWN = [
  "## GET `/api/account/profile/completion`",
  "Own %. **70%** unlocks punch-in. Use `completeThese` for UI checklist.",
  "",
  "---",
  AUTH,
  "---",
].join("\n");

const COMPLETION_EMP = [
  "## GET `/api/employees/{{employeeId}}/profile-completion`",
  "One employee (or `me`). Includes `completeThese`.",
  "",
  "---",
  AUTH,
  "---",
].join("\n");

const COMPLETION_ME = [
  "## GET `/api/employees/me/profile-completion`",
  "ESS own %. Punch-in needs `percentage >= 70`.",
  "",
  "---",
  AUTH,
  "---",
].join("\n");

function walk(items, fn) {
  for (const it of items || []) {
    fn(it);
    if (it.item) walk(it.item, fn);
  }
}

function replaceFolder(items, name, folder) {
  for (let i = 0; i < (items || []).length; i++) {
    if (items[i].name === name) {
      items[i] = folder;
      return true;
    }
    if (items[i].item && replaceFolder(items[i].item, name, folder)) return true;
  }
  return false;
}

function patchLoginDescription(oldDesc, roleLabel, seedLine) {
  return [
    `Login as **${roleLabel}**. Saves {{token}} and {{myId}}.`,
    "",
    seedLine,
    "",
    LOGIN_BODY_BLOCK,
    "",
    "**Use local after seed:** `{{baseUrl}}` = `http://localhost:9001`, No Environment.",
    "",
    "---",
    TIP,
    "---",
  ].join("\n");
}

const adminNotif = {
  name: "1.12 Notifications (FCM)",
  description: [
    "## Notifications (Admin / HR / RM)",
    "",
    "After login, register FCM via `POST /token`, then list / mark read.",
    "",
    "| # | API | When |",
    "|---|-----|------|",
    "| 1 | `POST /token` | Register / refresh FCM (required for push) |",
    "| 2 | `GET /` | List (company / team / all scoped) |",
    "| 3 | `PUT /:id/read` | Mark read |",
    "",
    "Punch-in `% < 70` → `403 PROFILE_INCOMPLETE` + push if FCM was registered.",
  ].join("\n"),
  item: [
    {
      name: "1. Register FCM Token",
      request: {
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: {
          raw: "{{baseUrl}}/api/notifications/token",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications", "token"],
        },
        description: REGISTER_DOC,
        body: {
          mode: "raw",
          raw: JSON.stringify(
            { token: "{{fcmToken}}", platform: "android", deviceId: "device-1" },
            null,
            2
          ),
          options: { raw: { language: "json" } },
        },
      },
      response: [],
    },
    {
      name: "2. List Notifications",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "const j = pm.response.json();",
              "const row = j.notifications && j.notifications[0];",
              "if (row && row.id) pm.collectionVariables.set('notificationId', row.id);",
            ],
          },
        },
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/notifications?page=1&limit=20",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications"],
          query: [
            { key: "page", value: "1" },
            { key: "limit", value: "20" },
            { key: "unread", value: "true", disabled: true },
            { key: "type", value: "PROFILE_COMPLETION", disabled: true },
            { key: "userId", value: "{{employeeId}}", disabled: true },
          ],
        },
        description: LIST_DOC_ADMIN,
      },
      response: [],
    },
    {
      name: "3. Mark Read",
      request: {
        method: "PUT",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/notifications/{{notificationId}}/read",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications", "{{notificationId}}", "read"],
        },
        description: MARK_DOC,
      },
      response: [],
    },
  ],
};

const essNotif = {
  name: "2.1b Notifications (accept web + app)",
  description: [
    "## Employee — enable notifications (web + app)",
    "",
    "1. Login (`username` + `password`) → JWT",
    "2. Get FCM token from Firebase SDK (user taps Allow)",
    "3. **Register Token** `POST /api/notifications/token`",
    "4. **My Notifications** / **Mark Read** below",
    "",
    "| Platform | `platform` |",
    "|----------|------------|",
    "| Browser | `web` |",
    "| Android | `android` |",
    "| iOS | `ios` |",
    "",
    "Seed: `shivangi@techculture.ai` / `TC00415012005`.",
  ].join("\n"),
  item: [
    {
      name: "1. Register FCM Token",
      request: {
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: {
          raw: "{{baseUrl}}/api/notifications/token",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications", "token"],
        },
        description: REGISTER_DOC,
        body: {
          mode: "raw",
          raw: JSON.stringify(
            {
              token: "{{fcmToken}}",
              platform: "android",
              deviceId: "employee-phone-1",
            },
            null,
            2
          ),
          options: { raw: { language: "json" } },
        },
      },
      response: [],
    },
    {
      name: "2. My Notifications",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "const j = pm.response.json();",
              "const row = j.notifications && j.notifications[0];",
              "if (row && row.id) pm.collectionVariables.set('notificationId', row.id);",
            ],
          },
        },
      ],
      request: {
        method: "GET",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/notifications?page=1&limit=20",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications"],
          query: [
            { key: "page", value: "1" },
            { key: "limit", value: "20" },
            { key: "unread", value: "true", disabled: true },
            { key: "type", value: "PROFILE_COMPLETION", disabled: true },
          ],
        },
        description: LIST_DOC_EMP,
      },
      response: [],
    },
    {
      name: "3. Mark Read",
      request: {
        method: "PUT",
        header: [],
        url: {
          raw: "{{baseUrl}}/api/notifications/{{notificationId}}/read",
          host: ["{{baseUrl}}"],
          path: ["api", "notifications", "{{notificationId}}", "read"],
        },
        description: MARK_DOC,
      },
      response: [],
    },
  ],
};

// --- apply ---
if (!replaceFolder(c.item, adminNotif.name, adminNotif)) {
  const admin = (c.item || []).find((i) => i.name === "1. ADMIN");
  if (admin?.item) {
    const after = admin.item.findIndex((i) => i.name === "1.5 Employees");
    if (after >= 0) admin.item.splice(after + 1, 0, adminNotif);
    else admin.item.push(adminNotif);
  }
}
console.log("Admin notifications docs OK");

const ess = (c.item || []).find((i) => i.name === "2. EMPLOYEE (ESS)");
if (ess?.item) {
  const idx = ess.item.findIndex(
    (i) => i.name === essNotif.name || String(i.name).includes("2.1b Notifications")
  );
  if (idx >= 0) ess.item[idx] = essNotif;
  else {
    const p = ess.item.findIndex((i) => i.name === "2.1 My Profile");
    if (p >= 0) ess.item.splice(p + 1, 0, essNotif);
    else ess.item.unshift(essNotif);
  }
  ess.description = [
    "Employee self-service. Start **2.1 My Profile → Login**.",
    "Seed: `employee@techculture.ai` / `TC00515012005` or `shivangi@techculture.ai` / `TC00415012005`.",
    "",
    "**Notifications:** Login ke baad **2.1b** → Register FCM Token, phir My Notifications / Mark Read.",
    "",
    "Switch to **0. Login** (Super Admin) before **1. ADMIN**.",
  ].join("\n");
  console.log("ESS notifications docs OK");
}

const loginMeta = [
  {
    match: (n, raw, body) =>
      n.includes("Super Admin") || body.includes("superadmin@gmail.com"),
    role: "Super Admin",
    seed: "Seed: `superadmin@gmail.com` / `123456`.",
  },
  {
    match: (n, raw, body) =>
      (n.includes("Login (Admin)") || n === "5. Login (Admin)") &&
      body.includes("admin@gmail.com"),
    role: "Admin",
    seed: "Seed: `admin@gmail.com` / `123456`.",
  },
  {
    match: (n, raw, body) =>
      n.includes("HR") || body.includes("anupama@techculture.ai"),
    role: "HR Manager",
    seed: "Seed: `anupama@techculture.ai` / `TC00115012005`.",
  },
  {
    match: (n, raw, body) =>
      n.includes("Reporting Manager") || body.includes("manav@techculture.ai"),
    role: "Reporting Manager",
    seed: "Seed: `manav@techculture.ai` / `TC00215012005`.",
  },
  {
    match: (n, raw, body) =>
      n.toLowerCase().includes("employee") ||
      body.includes("employee@techculture.ai") ||
      body.includes("shivangi@techculture.ai"),
    role: "Employee",
    seed: "Seed: `employee@techculture.ai` / `TC00515012005` (or Shivangi `TC00415012005`).",
  },
];

walk(c.item, (it) => {
  const raw = it.request?.url?.raw || "";
  if (!it.request || !raw.includes("/api/auth/login")) return;
  const name = it.name || "";
  const body = it.request.body?.raw || "";
  const meta = loginMeta.find((m) => m.match(name, raw, body));
  if (meta) {
    it.request.description = patchLoginDescription(
      it.request.description,
      meta.role,
      meta.seed
    );
  }
  // login body = username + password only (no FCM)
  if (body && body.includes("username")) {
    try {
      const parsed = JSON.parse(body);
      delete parsed.fcmToken;
      delete parsed.platform;
      delete parsed.deviceId;
      it.request.body.raw = JSON.stringify(parsed, null, 2);
    } catch {
      /* keep */
    }
  }
});
console.log("Login docs synced (JWT only; FCM via /notifications/token)");

walk(c.item, (it) => {
  if (it.name === "1. Punch In" && it.request?.url?.raw?.includes("punch-in")) {
    it.request.description = PUNCH_IN_DOC;
  }
});
console.log("Punch-in docs OK");

walk(c.item, (it) => {
  const raw = it.request?.url?.raw || "";
  if (!it.request) return;
  if (raw.includes("/api/employees/me/profile-completion")) {
    it.request.description = COMPLETION_ME;
  } else if (raw.includes("/api/account/profile/completion")) {
    it.request.description = COMPLETION_OWN;
  } else if (raw.includes("/profile-completion")) {
    it.request.description = COMPLETION_EMP;
  }
});
console.log("Profile completion docs OK");

const vars = c.variable || [];
for (const [key, value] of [
  ["fcmToken", ""],
  ["notificationId", ""],
]) {
  if (!vars.some((v) => v.key === key)) vars.push({ key, value });
}
c.variable = vars;

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("Postman collection fully updated");
