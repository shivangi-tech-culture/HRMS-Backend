/**
 * Add Project + Task APIs to HRMS_API.postman_collection.json
 * Flow: Company → Project CRUD → Task CRUD → Assign
 *
 * Run: node postman/_updateTaskApis.js
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

const tip =
  "_Tip: numbers/booleans/null unquoted. Dates = `YYYY-MM-DD`. Ids = 24-char hex._";

const flowGuide = `
## Standard flow (company checks on every step)

1. **Login** as Admin / HR (0. Login).
2. **Create Project** for \`{{companyId}}\` → saves \`{{projectId}}\`.
3. *(Optional)* **Assign Project Members** — Employees of that company.
4. **Create Task** with \`projectId\` (company comes from project) → saves \`{{taskId}}\`.
5. **Assign Task** — \`assigneeIds\` must be Employees of the **same company**.
6. Employee login → **My To Do Tasks** / **Mark Done**.

| Field | What it is for |
|-------|----------------|
| \`companyId\` | Company that owns the project (set on Project only). |
| \`projectId\` | Project the task belongs to. Required on task create. |
| \`memberIds\` / \`employeeIds\` | Project team (Employees of that company). |
| \`assignees\` / \`assigneeIds\` | Who must do the task (Employees of that company). |
| \`mode\` | \`add\` (default) · \`remove\` · \`replace\` on Assign APIs. |
`;

const getReq = (name, raw, description, query) => ({
  name,
  request: { method: "GET", header: [], url: urlOf(raw, query), description },
});

const jsonReq = (name, method, raw, description, body, testLines) => {
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
  if (testLines) {
    item.event = [
      { listen: "test", script: { type: "text/javascript", exec: testLines } },
    ];
  }
  return item;
};

const saveId = (varName) => [
  "const j = pm.response.json();",
  "const id = (j.data || {})._id;",
  `if (id) pm.collectionVariables.set('${varName}', id);`,
];

const adminProjects = {
  name: "1.11 Projects",
  description:
    "Admin **Work → Projects** — create project under a company first.\n" +
    "{{companyId}} / {{employeeId1}} auto-fill when empty.\n" +
    flowGuide,
  item: [
    jsonReq(
      "1. Create Project",
      "POST",
      "{{baseUrl}}/api/projects",
      "POST /api/projects — create project for one company.\n" +
        "Permission: **Work → Projects → create**.\n" +
        "Saves {{projectId}}.\n\n" +
        "---\n### Parameters\n**Header:** `Authorization: Bearer {{token}}`\n\n" +
        "**Body**\n" +
        "- `name` — string | **required** | project name (e.g. HR Ops)\n" +
        "- `companyId` — MongoId | **required** | company this project belongs to\n" +
        "- `description` — string | optional\n" +
        "- `status` — `Active` | `Inactive` | optional (default Active)\n" +
        "- `memberIds` — MongoId[] | optional | Employees of that company\n\n" +
        tip +
        "\n---\n",
      {
        name: "HR Ops",
        description: "HR operations checklist project",
        companyId: "{{companyId}}",
        status: "Active",
        memberIds: ["{{employeeId1}}"],
      },
      saveId("projectId")
    ),
    getReq(
      "2. List Projects",
      "{{baseUrl}}/api/projects?page={{page}}&limit={{limit}}",
      "GET /api/projects — company-scoped list.\nPermission: **Work → Projects → view**.\n\n" +
        "---\n### Query\n- `companyId` · `status` (Active|Inactive|ALL) · `search` · `page` · `limit`\n---\n",
      [
        q("companyId", "{{companyId}}", "MongoId | optional | one company", true),
        q("status", "Active", "Active | Inactive | ALL", true),
        q("search", "", "string | optional | project name", true),
        q("page", "{{page}}", "number | default 1"),
        q("limit", "{{limit}}", "number | 1–100"),
      ]
    ),
    getReq(
      "3. Get Project",
      "{{baseUrl}}/api/projects/{{projectId}}",
      "GET /api/projects/:id — one project with members.\n{{projectId}} from Create / List."
    ),
    jsonReq(
      "4. Update Project",
      "PUT",
      "{{baseUrl}}/api/projects/{{projectId}}",
      "PUT /api/projects/:id — name / description / status.\nDoes not change members — use Assign.",
      {
        name: "HR Ops",
        description: "Updated notes",
        status: "Active",
      }
    ),
    jsonReq(
      "5. Assign Project Members",
      "POST",
      "{{baseUrl}}/api/projects/{{projectId}}/assign",
      "POST /api/projects/:id/assign — add/remove/replace project team.\n" +
        "Permission: **Work → Projects → assign**.\n" +
        "Every id must be an **Employee** of the **same company** as the project.\n\n" +
        "---\n### Body\n" +
        "- `employeeIds` — MongoId[] | **required**\n" +
        "- `mode` — `add` (default) | `remove` | `replace`\n---\n",
      {
        employeeIds: ["{{employeeId1}}", "{{employeeId2}}"],
        mode: "add",
      }
    ),
    {
      name: "6. Delete Project",
      request: {
        method: "DELETE",
        header: [],
        url: urlOf("{{baseUrl}}/api/projects/{{projectId}}"),
        description:
          "DELETE /api/projects/:id\nBlocked (409) while tasks still link to this project.",
      },
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "if (pm.response.code >= 200 && pm.response.code < 300) {",
              "  pm.collectionVariables.set('projectId', '');",
              "}",
            ],
          },
        },
      ],
    },
  ],
};

const adminTasks = {
  name: "1.12 Tasks",
  description:
    "Admin **Work → Tasks** — tasks live under a Project.\n" +
    "Run **1.11 Projects → 1. Create Project** first (needs {{projectId}}).\n" +
    flowGuide,
  item: [
    jsonReq(
      "1. Create Task",
      "POST",
      "{{baseUrl}}/api/tasks",
      "POST /api/tasks — create under a project.\n" +
        "Permission: **Work → Tasks → create**.\n" +
        "`companyId` is taken from the project (optional in body; must match if sent).\n" +
        "`assignees` optional here — or use **5. Assign Task** after create.\n" +
        "Saves {{taskId}}.\n\n" +
        "---\n### Body\n" +
        "- `title` — string | **required**\n" +
        "- `projectId` — MongoId | **required** | from 1.11 Create Project\n" +
        "- `description` — string | optional\n" +
        "- `companyId` — MongoId | optional | must equal project's company\n" +
        "- `assignees` — MongoId or MongoId[] | optional | Employees of project company\n" +
        "- `dueDate` — YYYY-MM-DD | optional\n" +
        "- `priority` — High | Medium | Low\n" +
        "- `status` — To Do | In Progress | Completed\n---\n",
      {
        title: "Submit weekly attendance summary",
        description: "Compile last week's attendance and send to HR Desk.",
        projectId: "{{projectId}}",
        companyId: "{{companyId}}",
        assignees: ["{{employeeId1}}"],
        dueDate: "2026-10-30",
        priority: "High",
        status: "To Do",
      },
      saveId("taskId")
    ),
    getReq(
      "2. List Tasks",
      "{{baseUrl}}/api/tasks?page={{page}}&limit={{limit}}",
      "GET /api/tasks — company-scoped. Filter by projectId / assignee / status.\n\n" +
        "---\n### Query\n- `companyId` · `projectId` · `assignee` · `status` · `priority` · `search` · `page` · `limit`\n---\n",
      [
        q("companyId", "{{companyId}}", "MongoId | optional", true),
        q("projectId", "{{projectId}}", "MongoId | optional | one project", true),
        q("assignee", "{{employeeId1}}", "MongoId | optional | in assignees[]", true),
        q("status", "ALL", "To Do | In Progress | Completed | Over Due | ALL", true),
        q("priority", "High", "High | Medium | Low", true),
        q("search", "", "title / description", true),
        q("page", "{{page}}", "number"),
        q("limit", "{{limit}}", "number"),
      ]
    ),
    getReq(
      "3. Get Task",
      "{{baseUrl}}/api/tasks/{{taskId}}",
      "GET /api/tasks/:id — project + assignees + company populated."
    ),
    jsonReq(
      "4. Update Task",
      "PUT",
      "{{baseUrl}}/api/tasks/{{taskId}}",
      "PUT /api/tasks/:id — title, projectId, assignees, dueDate, priority, status.",
      {
        title: "Submit weekly attendance summary (updated)",
        description: "Include late/early counts.",
        dueDate: "2026-10-31",
        priority: "Medium",
        status: "In Progress",
      }
    ),
    jsonReq(
      "5. Assign Task",
      "POST",
      "{{baseUrl}}/api/tasks/{{taskId}}/assign",
      "POST /api/tasks/:id/assign — add/remove/replace assignees.\n" +
        "Permission: **Work → Tasks → assign**.\n" +
        "Every assignee must be Employee of the **task's company** (same as project).\n\n" +
        "---\n### Body\n" +
        "- `assigneeIds` — MongoId[] | **required**\n" +
        "- `mode` — `add` | `remove` | `replace`\n---\n",
      {
        assigneeIds: ["{{employeeId1}}"],
        mode: "replace",
      }
    ),
    {
      name: "6. Delete Task",
      request: {
        method: "DELETE",
        header: [],
        url: urlOf("{{baseUrl}}/api/tasks/{{taskId}}"),
        description: "DELETE /api/tasks/:id — permanent delete.",
      },
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "if (pm.response.code >= 200 && pm.response.code < 300) {",
              "  pm.collectionVariables.set('taskId', '');",
              "}",
            ],
          },
        },
      ],
    },
  ],
};

const employeeTasks = {
  name: "2.7 Tasks (To Do)",
  description:
    "Employee **Tasks → To Do Tasks**.\n" +
    "Shows tasks where you are in `assignees[]`.\n" +
    "Admin must Create Project → Create/Assign Task first.\n" +
    flowGuide,
  item: [
    getReq(
      "1. My To Do Tasks",
      "{{baseUrl}}/api/tasks/me?page={{page}}&limit={{limit}}",
      "GET /api/tasks/me — only tasks assigned to the logged-in employee.\n" +
        "UI Project column = `projectId.name` (no duplicate `project` string).\n\n" +
        "---\n### Query\n- `projectId` · `status` · `priority` · `search` · `page` · `limit`\n---\n",
      [
        q("projectId", "{{projectId}}", "MongoId | optional", true),
        q("status", "ALL", "To Do | In Progress | Completed | Over Due | ALL", true),
        q("priority", "High", "High | Medium | Low", true),
        q("search", "", "title / description", true),
        q("page", "{{page}}", "number"),
        q("limit", "{{limit}}", "number"),
      ]
    ),
    jsonReq(
      "2. Mark Done (Update Status)",
      "PATCH",
      "{{baseUrl}}/api/tasks/me/{{taskId}}/status",
      "PATCH /api/tasks/me/:id/status — Done button.\nOnly if you are in assignees[].\n\n" +
        "---\n### Body\n- `status` — To Do | In Progress | Completed | **required**\n---\n",
      { status: "Completed" }
    ),
  ],
};

employeeTasks.item[0].event = [
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

const admin = collection.item.find((f) => f.name && f.name.includes("ADMIN"));
const employee = collection.item.find((f) => f.name && f.name.includes("EMPLOYEE"));
if (!admin || !employee) throw new Error("Admin or Employee folder missing");

const replaceFolder = (parent, name, folder) => {
  const index = parent.item.findIndex((item) => item.name === name);
  if (index >= 0) parent.item.splice(index, 1, folder);
  else parent.item.push(folder);
};

// Remove old combined 1.11 Tasks if present, then add Projects + Tasks
const oldTasks = admin.item.findIndex((item) => item.name === "1.11 Tasks");
if (oldTasks >= 0) admin.item.splice(oldTasks, 1);

replaceFolder(admin, "1.11 Projects", adminProjects);
replaceFolder(admin, "1.12 Tasks", adminTasks);
replaceFolder(employee, "2.7 Tasks (To Do)", employeeTasks);

for (const key of ["projectId", "taskId"]) {
  if (!collection.variable.some((row) => row.key === key)) {
    collection.variable.push({ key, value: "" });
  }
}

if (collection.info?.description && !collection.info.description.includes("1.11 Projects")) {
  collection.info.description = collection.info.description.replace(
    /Task Management:.*?\n\n/s,
    "Work: **1.11 Projects** → **1.12 Tasks** (assign) · **2.7 Tasks (To Do)**.\n\n"
  );
  if (!collection.info.description.includes("1.11 Projects")) {
    collection.info.description = collection.info.description.replace(
      "Piece seeds:",
      "Work: **1.11 Projects** → **1.12 Tasks** (assign) · **2.7 Tasks (To Do)**.\n\nPiece seeds:"
    );
  }
}

fs.writeFileSync(file, JSON.stringify(collection, null, 2) + "\n");
console.log("Added: 1.11 Projects, 1.12 Tasks, 2.7 Tasks (To Do)");
