/**
 * Add Forgot Password + Employee Dashboard + Task Dashboard to Postman collection.
 * Does not remove or rewrite unrelated folders.
 *
 * Run: node postman/_updateForgotDashboardApis.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const collection = JSON.parse(fs.readFileSync(file, "utf8"));

const tip =
  "_Tip: numbers/booleans/null unquoted. Dates = `YYYY-MM-DD`. Ids = 24-char hex._";

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

const q = (key, value, description, disabled) => {
  const row = { key, value, description };
  if (disabled) row.disabled = true;
  return row;
};

const getReq = (name, raw, description, query) => ({
  name,
  request: { method: "GET", header: [], url: urlOf(raw, query), description },
});

const jsonReq = (name, method, raw, description, body, testLines, noAuth) => {
  const item = {
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
  };
  if (noAuth) item.request.auth = { type: "noauth" };
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

const upsertItem = (parent, name, item) => {
  const index = parent.item.findIndex((row) => row.name === name);
  if (index >= 0) parent.item.splice(index, 1, item);
  else parent.item.push(item);
};

const insertAfter = (parent, afterName, item) => {
  const existing = parent.item.findIndex((row) => row.name === item.name);
  if (existing >= 0) parent.item.splice(existing, 1);
  const after = parent.item.findIndex((row) => row.name === afterName);
  if (after >= 0) parent.item.splice(after + 1, 0, item);
  else parent.item.push(item);
};

const loginFolder = collection.item.find(
  (f) => f.name && f.name.includes("Login & My Account")
);
const employee = collection.item.find(
  (f) => f.name && f.name.includes("EMPLOYEE")
);
if (!loginFolder || !employee) {
  throw new Error("Login or Employee folder missing in Postman collection");
}

const forgotPassword = jsonReq(
  "3c. Forgot Password",
  "POST",
  "{{baseUrl}}/api/auth/forgot-password",
  "## POST `/api/auth/forgot-password`\n" +
    "Public — no Bearer token.\n\n" +
    "Sends a **1-hour** password reset link to the official or personal email.\n" +
    "Response message is always the same (does **not** reveal whether the email exists).\n\n" +
    "---\n### Body\n" +
    "| Field | Type | Required | Notes |\n|-------|------|----------|-------|\n" +
    "| `email` | string (email) | yes | official or personal email |\n\n" +
    "**Seed example:** `shivangi@techculture.ai` (TC004) or `employee@techculture.ai` (TC005).\n\n" +
    "Frontend link format: `{APP_URL}/reset-password?token=<rawToken>`\n" +
    "(set `APP_URL` in `.env`, default `https://hrms-techculture.vercel.app`).\n\n" +
    tip +
    "\n---\n",
  { email: "shivangi@techculture.ai" },
  null,
  true
);

const resetPassword = jsonReq(
  "3d. Reset Password",
  "POST",
  "{{baseUrl}}/api/auth/reset-password",
  "## POST `/api/auth/reset-password`\n" +
    "Public — no Bearer token.\n\n" +
    "Use the `token` query value from the forgot-password email.\n" +
    "On success the previous session JWT is cleared — user must **login** again.\n\n" +
    "---\n### Body\n" +
    "| Field | Type | Required | Notes |\n|-------|------|----------|-------|\n" +
    "| `token` | string | yes | raw token from email link |\n" +
    "| `newPassword` | string | yes | 6–50 chars; must differ from old |\n" +
    "| `confirmPassword` | string | yes | must match `newPassword` |\n\n" +
    tip +
    "\n---\n",
  {
    token: "{{resetToken}}",
    newPassword: "MyNewPass123",
    confirmPassword: "MyNewPass123",
  },
  null,
  true
);

insertAfter(loginFolder, "3b. Change My Password", forgotPassword);
insertAfter(loginFolder, "3c. Forgot Password", resetPassword);

loginFolder.description =
  "Login first — every other request uses {{token}}.\n" +
  "Body: `{ \"username\", \"password\" }` — username = code / email / mobile.\n" +
  "Use local baseUrl after `npm run seed`. Super Admin / Admin = `123456`; staff = code + DOB `15012005`.\n\n" +
  "**Module notes:** Auth + profile. Login returns `token` (single session). " +
  "GET /token-status → `isExpired` / `isReplaced`. Logout clears cookie + DB token.\n" +
  "**Forgot password:** `3c` sends email · `3d` sets new password with email token (public).\n";

const employeeDashboardFolder = {
  name: "2.0 Dashboard (My Home)",
  description:
    "Employee **Dashboard → My Home** (UI `/employee`).\n" +
    "One aggregate API for greeting, summary counts, today attendance, monthly/weekly stats, " +
    "pending tasks, leaves/holidays, events, notifications, profile %.\n" +
    "Permission: **Dashboard → My Home → view**.\n" +
    "Login as Employee first (e.g. TC004 / TC005).\n",
  item: [
    getReq(
      "1. Employee Dashboard",
      "{{baseUrl}}/api/dashboard/employee",
      "## GET `/api/dashboard/employee`\n" +
        "ESS home widgets for the logged-in employee.\n\n" +
        "Permission: **Dashboard → My Home → view** (Employee only).\n\n" +
        "---\n### Response `data` (high level)\n" +
        "| Key | UI widget |\n|-----|-----------|\n" +
        "| `greeting` | Good morning/afternoon, {name} |\n" +
        "| `summary` | Attendance / On Tour / Leaves / Others counts |\n" +
        "| `attendanceToday` | Punch card — hours, late/early |\n" +
        "| `monthlyStats` | Work days, absent, late, OT, early |\n" +
        "| `weeklyWorkingHours` | Week 1…5 hours bars |\n" +
        "| `pendingTasks` | Pending Tasks list + count |\n" +
        "| `leavesHolidays` | Approved leaves + upcoming holidays |\n" +
        "| `events` | Birthdays / work anniversaries |\n" +
        "| `notifications.unreadCount` | Bell badge |\n" +
        "| `profileCompletion` | Profile % |\n" +
        "| `importantLinks` | Quick links |\n\n" +
        "**Header:** `Authorization: Bearer {{token}}`\n\n" +
        tip +
        "\n---\n"
    ),
  ],
};

const taskDashboardFolder = {
  name: "2.7 Tasks (To Do)",
  description:
    "Employee **Tasks → To Do Tasks** + **Tasks → Dashboard**.\n" +
    "Shows tasks where you are in `assignees[]`.\n" +
    "Admin must Create Project → Create/Assign Task first (or employee **Add Task** via Dashboard create).\n",
  item: [
    getReq(
      "1. My To Do Tasks",
      "{{baseUrl}}/api/tasks/me?page={{page}}&limit={{limit}}",
      "GET /api/tasks/me — only tasks assigned to the logged-in employee.\n" +
        "Permission: **Tasks → To Do Tasks → view**.\n\n" +
        "---\n### Query\n- `projectId` · `status` · `priority` · `search` · `page` · `limit`\n" +
        "`status`: To Do | In Progress | Completed | Over Due | ALL\n---\n",
      [
        q("projectId", "{{projectId}}", "MongoId | optional", true),
        q(
          "status",
          "ALL",
          "To Do | In Progress | Completed | Over Due | ALL",
          true
        ),
        q("priority", "High", "High | Medium | Low", true),
        q("search", "", "title / description", true),
        q("page", "{{page}}", "number"),
        q("limit", "{{limit}}", "number"),
      ]
    ),
    getReq(
      "1b. Task Dashboard",
      "{{baseUrl}}/api/tasks/me/dashboard?days=15&category=ALL",
      "## GET `/api/tasks/me/dashboard`\n" +
        "Employee **Tasks → Dashboard** (UI `/employee/tasks`).\n\n" +
        "Permission: **Tasks → Dashboard → view**.\n\n" +
        "---\n### Query\n" +
        "| Param | Type | Default | Notes |\n|-------|------|---------|-------|\n" +
        "| `days` | number 7–90 | 15 | Task Progress window |\n" +
        "| `category` | string | ALL | Project name filter (or ALL) |\n" +
        "| `projectId` | MongoId | — | optional exact project |\n" +
        "| `listLimit` | number 1–50 | 10 | Task list size |\n\n" +
        "### Response `data`\n" +
        "| Key | Chart / widget |\n|-----|----------------|\n" +
        "| `taskProgress` | W1…W5 completed counts |\n" +
        "| `dueTaskSummary` | Donut — before / after / onTime / inProcess / pending |\n" +
        "| `overallHealth` | total · completed · onGoing · pending · dueTask |\n" +
        "| `workload` | Per project — completed / overDue / remaining |\n" +
        "| `criticalHealth` | Max assign + max due (company peers) |\n" +
        "| `taskList` | Cards — title, dueDate, priority, displayStatus |\n" +
        "| `categories` | Dropdown values for category filter |\n\n" +
        "**Statuses in list:** `To Do` · `In Progress` · `Completed` · display `Over Due` when past due.\n" +
        "**Priority:** High · Medium · Low\n\n" +
        tip +
        "\n---\n",
      [
        q("days", "15", "number | 7–90 | Task Progress window"),
        q("category", "ALL", "ALL or project name"),
        q("projectId", "{{projectId}}", "MongoId | optional", true),
        q("listLimit", "10", "number | task list size", true),
      ]
    ),
    jsonReq(
      "1c. Add a New Task (Employee)",
      "POST",
      "{{baseUrl}}/api/tasks/me",
      "## POST `/api/tasks/me`\n" +
        "Employee **Tasks → Dashboard → create** (`+ Add a New Task`).\n" +
        "Creates a task under `projectId` and auto-assigns the logged-in employee.\n" +
        "Project must belong to the employee's company.\n\n" +
        "Permission: **Tasks → Dashboard → create**.\n\n" +
        "---\n### Body\n" +
        "| Field | Type | Required | Notes |\n|-------|------|----------|-------|\n" +
        "| `title` | string | yes | min 2 |\n" +
        "| `projectId` | MongoId | yes | from Admin Projects |\n" +
        "| `description` | string | no | |\n" +
        "| `dueDate` | YYYY-MM-DD | no | |\n" +
        "| `priority` | High\\|Medium\\|Low | no | default Medium |\n\n" +
        tip +
        "\n---\n",
      {
        title: "Submit weekly attendance summary",
        description: "Self-created from Task Dashboard",
        projectId: "{{projectId}}",
        dueDate: "2026-10-31",
        priority: "High",
      },
      [
        "const j = pm.response.json();",
        "const id = (j.data || {})._id;",
        "if (id) pm.collectionVariables.set('taskId', id);",
      ]
    ),
    jsonReq(
      "2. Mark Done (Update Status)",
      "PATCH",
      "{{baseUrl}}/api/tasks/me/{{taskId}}/status",
      "PATCH /api/tasks/me/:id/status — Done button.\n" +
        "Only if you are in assignees[].\n" +
        "Permission: **Tasks → To Do Tasks → edit**.\n\n" +
        "---\n### Body\n- `status` — To Do | In Progress | Completed | **required**\n---\n",
      { status: "Completed" }
    ),
  ],
};

taskDashboardFolder.item[0].event = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const j = pm.response.json();",
        "const row = (j.data || []).find((r) => r.status !== 'Completed') || (j.data || [])[0];",
        "if (row && row._id) pm.collectionVariables.set('taskId', row._id);",
      ],
    },
  },
];

upsertItem(employee, "2.0 Dashboard (My Home)", employeeDashboardFolder);
// Keep 2.0 at the top of EMPLOYEE folder
{
  const idx = employee.item.findIndex(
    (row) => row.name === "2.0 Dashboard (My Home)"
  );
  if (idx > 0) {
    const [folder] = employee.item.splice(idx, 1);
    employee.item.unshift(folder);
  }
}
upsertItem(employee, "2.7 Tasks (To Do)", taskDashboardFolder);

if (!collection.variable.some((row) => row.key === "resetToken")) {
  collection.variable.push({
    key: "resetToken",
    value: "",
    description: "Paste raw token from forgot-password email link",
  });
}

if (collection.info?.description) {
  let desc = collection.info.description;
  if (!desc.includes("forgot-password")) {
    desc = desc.replace(
      "Piece seeds:",
      "Auth: **Forgot / Reset password** (0. Login → 3c / 3d).\n" +
        "ESS: **2.0 Dashboard (My Home)** · **2.7 Tasks** includes Task Dashboard.\n\nPiece seeds:"
    );
  }
  if (!desc.includes("2.0 Dashboard")) {
    desc +=
      "\n\nESS dashboards: `GET /api/dashboard/employee` · `GET /api/tasks/me/dashboard`.\n";
  }
  collection.info.description = desc;
}

fs.writeFileSync(file, JSON.stringify(collection, null, 2) + "\n");
console.log(
  "Updated Postman: 3c/3d Forgot-Reset, 2.0 Employee Dashboard, 2.7 Task Dashboard"
);
