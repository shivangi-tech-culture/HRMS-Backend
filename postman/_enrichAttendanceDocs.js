/**
 * Enrich Attendance (Punch + Regularization) Postman request descriptions.
 * Run: node postman/_enrichAttendanceDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

const tip =
  "\n\n_Tip: dates = `YYYY-MM-DD`, times = `HH:mm` (24h), month = `YYYY-MM`, ids = 24-char hex. Numbers/booleans/null unquoted._";

const DOCS = {
  // ── Folder 2.2 ─────────────────────────────────────────────
  "2.2 Attendance (Punch)": {
    folder: [
      "## Employee Attendance (self)",
      "Login as **Employee** first (folder 2.1 → Login).",
      "All requests need `Authorization: Bearer {{token}}` (or cookie `token`).",
      "",
      "### Flow",
      "1. **Punch In** → day becomes **MissedPunch** until punch-out.",
      "2. **Punch Out** → day scored vs shift → Present / Late / HalfDay / Absent.",
      "3. **My Time Sheet** → month grid; use `canApply` to know if regularize is allowed.",
      "4. Regularize:",
      "   - **6** = missed punch (send missing `HH:mm`)",
      "   - **6b** = Late day already punched (date + reason only)",
      "   - **6c** = break forgot / too long",
      "5. Manager/HR/Super Admin approve in **1.7 → 4. Attendance Regularization** (not here).",
      "",
      "### Day status codes (timesheet `status`)",
      "| Code | statusLabel | When |",
      "|------|-------------|------|",
      "| `P` | Present | Full day ok vs shift |",
      "| `L` | Late | Punch-in after grace; both punches present |",
      "| `A` | Absent | No usable attendance / too short |",
      "| `MP` | MissedPunch | Punch-in only, no punch-out |",
      "| `HD` | HalfDay | Left early / half leave + work |",
      "| `WO` | WeeklyOff | Off day, no work punch |",
      "| `H` | Holiday | Holiday |",
      "| `ELE` | EarlyLeave | Left before shift end (when scored) |",
      "| `Pending` | Pending | Regularization waiting review |",
      "| `Rejected` | Rejected | Regularization rejected |",
      "| leave code | leave name | Approved leave, no punch |",
      "| `OnDuty` / `OnTour` | Present display | Duty approved days show Present |",
    ].join("\n"),
  },

  "1. Punch In": {
    description: [
      "## POST `/api/attendance/punch-in`",
      "Start the work day for the **logged-in employee** (company/branch/shift from profile).",
      "",
      "### When to use",
      "Employee reaches office / starts WFH and taps **In**.",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `source` | string | yes | Where punch came from: `web` \\| `mobile` \\| `biometric` |",
      "| `latitude` | number | yes | GPS lat (−90…90). Address is resolved server-side via Map API |",
      "| `longitude` | number | yes | GPS lng (−180…180) |",
      "| `remarks` | string | no | Optional note (max 500), e.g. “Reached office” |",
      "",
      "### Result / status",
      "- Day status stays **`MissedPunch`** until punch-out.",
      "- `attendanceStatus`: **Early** (before shift start), **On time** (start → grace), or **Late** (after grace).",
      "- Early minutes before shift start are **not** counted in worked hours.",
      "- Saves `{{attendanceId}}` from response.",
      "",
      "### Auth",
      "`Authorization: Bearer {{token}}`",
      tip,
    ].join("\n"),
  },

  "2. Punch Out": {
    description: [
      "## POST `/api/attendance/punch-out`",
      "End the work day. **Status is calculated from the assigned shift**, not from a fixed early-exit rule alone.",
      "",
      "### When to use",
      "Employee leaves / ends work for the day (must already be punched in).",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `source` | string | yes | `web` \\| `mobile` \\| `biometric` |",
      "| `latitude` | number | yes | GPS lat |",
      "| `longitude` | number | yes | GPS lng |",
      "| `remarks` | string | no | Optional note |",
      "",
      "### Example (shift 10:00–19:00)",
      "| In | Out | Result |",
      "|----|-----|--------|",
      "| 08:00 | 19:00 | **Present** (hours count from shift start 10:00) |",
      "| 11:00 / 12:00 | 19:00 | **Late** |",
      "| 08:00 | 18:00 | **HalfDay** (left before shift end) |",
      "| in then out in first half (e.g. 2 min) | | **Absent** |",
      "| in only, no out | | stays **MissedPunch** |",
      "",
      "### Other fields returned",
      "- `workingHours` / overtime: overtime only **after** shift end.",
      "- `lateByMinutes` / `earlyByMinutes` vs shift window.",
      tip,
    ].join("\n"),
  },

  "3. My Today": {
    description: [
      "## GET `/api/attendance/today`",
      "Today’s attendance card for the logged-in employee.",
      "",
      "### When to use",
      "Home / dashboard “today” widget: punch state, shift, company, branch.",
      "",
      "### Query",
      "None.",
      "",
      "### Response (typical)",
      "| Field | Use |",
      "|-------|-----|",
      "| punch in/out times | Current day punches |",
      "| `status` | Day status (Present, MissedPunch, …) |",
      "| company / branch / shift | Assignment context |",
      "| working hours, late/early | After punch-out |",
      "",
      "### Auth",
      "`Authorization: Bearer {{token}}`",
      tip,
    ].join("\n"),
  },

  "4. My Punches": {
    description: [
      "## GET `/api/attendance/web-punches`",
      "Own IN/OUT punch history (paginated list for “My Web Punches”).",
      "",
      "### When to use",
      "Employee views past punches; filter by date range or status.",
      "",
      "### Query params",
      "| Param | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `from` | YYYY-MM-DD | no | Range start |",
      "| `to` | YYYY-MM-DD | no | Range end |",
      "| `date` | YYYY-MM-DD | no | Single day (instead of from/to) |",
      "| `status` | string | no | `ALL` or day status: Present, Absent, HalfDay, WeeklyOff, Holiday, MissedPunch, OnLeave, WFH, Pending, … |",
      "| `page` | number | no | Default `1` |",
      "| `limit` | number | no | Rows per page (1–200, default 50) |",
      "",
      "### Auth",
      "`Authorization: Bearer {{token}}` + permission **Self → My Web Punches → view**",
      tip,
    ].join("\n"),
  },

  "4b. Punch Status": {
    description: [
      "## GET `/api/attendance/punch-status`",
      "Punch in/out status for **one date**. Employee + company come from the **login token** (not query).",
      "",
      "### When to use",
      "UI “Am I punched in today?” / day detail before regularize.",
      "",
      "### Query params",
      "| Param | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `date` | YYYY-MM-DD | yes | Day to check. Future dates → `400` |",
      "",
      "### Response fields",
      "| Field | Use |",
      "|-------|-----|",
      "| `punchedIn` / `punchedOut` | Booleans |",
      "| `punchInTime` / `punchOutTime` | Clock times |",
      "| punch cards | `time`, `at`, `source`, `location` |",
      "| `status` | Day status; no row → treated as **Absent** |",
      "| `attendanceStatus` | Early / On time / Late / Approved / … |",
      "| `workMode` | WFO / WFH / … |",
      "| `workingHours`, `overtime` | After out |",
      "| `lateByMinutes`, `earlyByMinutes` | Vs shift |",
      "| `shift` | Assigned shift (`_id`, code, name, start/end, halfDayEnd, grace) or `null` |",
      "| `company`, `employee`, `attendanceId` | Context |",
      tip,
    ].join("\n"),
  },

  "5. My Time Sheet": {
    description: [
      "## GET `/api/attendance/timesheet`",
      "Employee **month timesheet** (company attendance month, or custom from–to).",
      "Self: omit `employeeId`. HR/Manager/Admin may pass another employee in scope.",
      "",
      "### When to use",
      "ESS Time Sheet screen — day rows + month summary; decide whether to open Regularize.",
      "",
      "### Query params",
      "| Param | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `month` | YYYY-MM | no* | Company month label (e.g. `2026-10`). Uses company month-start day (1 or e.g. 24) |",
      "| `from` | YYYY-MM-DD | no* | Custom range start (with `to`) |",
      "| `to` | YYYY-MM-DD | no* | Custom range end; max **62 days** |",
      "| `employeeId` | MongoId | no | Other employee (not for Employee role) |",
      "",
      "\\* Use either `month` **or** `from`/`to`. Default month = current.",
      "",
      "### Each row in `data[]`",
      "| Field | Use |",
      "|-------|-----|",
      "| `date` | Day YYYY-MM-DD |",
      "| `day` | Weekday name (Mon, Tue, …) |",
      "| `shift` | Shift name, or “Weekly Off” |",
      "| `inTime` / `outTime` | Display labels like `10 Oct 09:30` |",
      "| `inOut` | Combined punch display, or `—` if none |",
      "| `punchInTime` / `punchOutTime` | Raw `HH:mm` |",
      "| `workedHours` | `HH:mm` worked (00:00 if empty) |",
      "| `hours` | Human label (e.g. `8h 30m`) |",
      "| `status` | Short code for UI badge (see below) |",
      "| `statusLabel` | Full label: Present, Late, Absent, MissedPunch, … |",
      "| `dayDesc` | WorkDay \\| WeeklyOff \\| Leave \\| On Duty \\| On Tour |",
      "| `canApply` | `true` → employee may create a regularization for this day |",
      "| `requestStatus` | Latest reg: Pending / Approved / Rejected / Cancelled / \"\" |",
      "| `reason` / `remarks` | From regularization or attendance |",
      "| `lateByMinutes` / `earlyByMinutes` | Vs shift that day |",
      "",
      "### `status` codes",
      "| Code | Meaning |",
      "|------|---------|",
      "| `P` | Present |",
      "| `L` | Late |",
      "| `A` | Absent |",
      "| `MP` | Missed punch (no punch-out) |",
      "| `HD` | Half day |",
      "| `WO` | Weekly off |",
      "| `H` | Holiday |",
      "| `ELE` | Early leave |",
      "| `Pending` | Regularization pending |",
      "| `Rejected` | Regularization rejected |",
      "| leave code | e.g. CL / SL / UL from leave type |",
      "",
      "### When `canApply` is true",
      "All of these:",
      "- `date` ≤ today",
      "- `dayDesc` is **WorkDay**",
      "- `status` is one of: **A**, **MP**, **L**, **ELE**, **HD**, **Rejected**",
      "- No request already **Pending** or **Approved** for that date",
      "",
      "### Which regularize API to call",
      "| Situation | Use request | Body |",
      "|-----------|-------------|------|",
      "| Missing in and/or out (`MP` / some `A`) | **6. Request Regularization** | `date` + missing `punchInTime`/`punchOutTime` + `reason` |",
      "| Day is **Late** but both punches exist | **6b. Request Late Regularization** | `date` + `reason` only (no new times) |",
      "| Break forgotten / too long | **6c. Request Break Regularization** | `date` + break times + `reason` |",
      "",
      "### Top-level response",
      "`employee`, `month`, `label`, `from`, `to`, `summary` (present/absent/missedPunch/pending/leaves/payable…), `total`, `data`.",
      tip,
    ].join("\n"),
  },

  "6. Request Regularization": {
    description: [
      "## POST `/api/attendance/regularize` — Missed punch",
      "Employee self-only. Fix a day where **punch-in and/or punch-out is missing**.",
      "",
      "### When to use",
      "- Timesheet `status` = **MP** (punched in, forgot out), or",
      "- Absent / incomplete punches needing times filled.",
      "- **Do not** use for a Late day that already has both punches → use **6b**.",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `date` | YYYY-MM-DD | yes | Attendance day to fix |",
      "| `punchInTime` | HH:mm | if in missing | Proposed punch-in (24h) |",
      "| `punchOutTime` | HH:mm | if out missing | Proposed punch-out (24h) |",
      "| `reason` | string | yes | From master `regularizationReason` or free text (max 200) |",
      "| `remarks` | string | no | Extra note (max 500) |",
      "| `document` | string URL | no | Optional proof attachment URL |",
      "",
      "Send at least the **missing** time(s). One **Pending** request per date.",
      "",
      "### After submit",
      "- Request status **Pending**; timesheet may show **Pending**.",
      "- Until approved, no punch-out still displays as **MissedPunch** on the day logic.",
      "- Approve/reject: **1.7 → 4. Attendance Regularization** (RM / HR / Super Admin).",
      "- Test script saves `_id` → `{{regularizationId}}`.",
      tip,
    ].join("\n"),
  },

  "6b. Request Late Regularization": {
    description: [
      "## POST `/api/attendance/regularize` — Late day",
      "Employee self-only. Day is already **Late** with **both punches saved**.",
      "",
      "### When to use",
      "Example shift 10:00–19:00, in at 11:00/12:00, out at 19:00 → status **Late**.",
      "Employee explains why they were late (traffic, client, etc.).",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `date` | YYYY-MM-DD | yes | The Late day |",
      "| `reason` | string | yes | Why late |",
      "| `remarks` | string | no | Extra detail |",
      "",
      "**Do not** send `punchInTime` / `punchOutTime` — punches already exist.",
      "",
      "### After approve / reject",
      "| Decision | Day `status` | `attendanceStatus` |",
      "|----------|-------------|---------------------|",
      "| Approve | stays **Late** | **Approved** |",
      "| Reject | stays **Late** | **Rejected** |",
      "",
      "Reviewers: Reporting Manager (team), HR (assigned companies), Super Admin.",
      "One Pending per date. Saves `{{regularizationId}}`.",
      tip,
    ].join("\n"),
  },

  "6c. Request Break Regularization": {
    description: [
      "## POST `/api/attendance/regularize` — Break",
      "Employee self-only. Correct **break** timing (forgot to end break, or break ran long).",
      "",
      "### When to use",
      "Open/wrong break on a worked day; not for missing main punch-in/out (use **6**).",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `date` | YYYY-MM-DD | yes | Day of the break |",
      "| `breakType` | string | yes* | e.g. `Lunch Break` |",
      "| `breakStartTime` | HH:mm | if no open break | Start; omit if a break is still open (server keeps open start) |",
      "| `breakEndTime` | HH:mm | yes | End time to apply |",
      "| `reason` | string | yes | Why correcting |",
      "| `remarks` | string | no | Extra note |",
      "",
      "### After approve",
      "Writes break times, closes forgotten open break, recounts working hours vs shift.",
      "Reject leaves break as-is. Review in **1.7 → 4**.",
      "One Pending per date. Saves `{{regularizationId}}`.",
      tip,
    ].join("\n"),
  },

  "7. My Regularization Requests": {
    description: [
      "## GET `/api/attendance/regularize`",
      "List **your own** regularization requests (missed punch, late, break).",
      "",
      "### When to use",
      "ESS “My Regularization” history / track Pending vs Approved.",
      "",
      "### Query params",
      "| Param | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `status` | string | no | `ALL` (default) \\| `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` |",
      "| `from` / `to` | YYYY-MM-DD | no | Filter by attendance date range |",
      "| `page` / `limit` | number | no | Pagination (limit max 100) |",
      "",
      "### Row fields (typical)",
      "`date`, punch in/out (if any), break fields, `reason`, `remarks`, submittedAt, `status`.",
      tip,
    ].join("\n"),
  },

  "8. Cancel Regularization": {
    description: [
      "## POST `/api/attendance/regularize/:id/cancel`",
      "Withdraw **your own** request while it is still **Pending**.",
      "",
      "### When to use",
      "Employee filed wrong times/reason and wants to re-apply.",
      "",
      "### Path",
      "| Param | Use |",
      "|-------|-----|",
      "| `{{regularizationId}}` | From request **6 / 6b / 6c** or list **7** |",
      "",
      "### Rules",
      "- Only **Pending** can be cancelled.",
      "- **Approved** / **Rejected** → cannot cancel.",
      "- After cancel, timesheet `canApply` can become true again if day still qualifies.",
      tip,
    ].join("\n"),
  },

  "9a. On Tour Categories": {
    description: [
      "## GET `/api/masters?type=onTourCategory`",
      "Dropdown values for **On Tour** applications.",
      "",
      "### Use",
      "Run before **9. Apply On Tour**. Saves first `_id` → `{{onTourCategoryId}}`.",
      "Typical names: Up Country, Local, Intrastate, International.",
      "Send this **`_id`** in `tourCategory` (not the name).",
      tip,
    ].join("\n"),
  },

  "9b. On Duty Categories": {
    description: [
      "## GET `/api/masters?type=onDutyCategory`",
      "Dropdown values for **On Duty** applications.",
      "",
      "### Use",
      "Run before **9** with `dutyType: \"On Duty\"`. Saves `{{onDutyCategoryId}}`.",
      "Typical: Client Site, Bank Work, Field Visit, Office Duty.",
      tip,
    ].join("\n"),
  },

  "9. Apply On Tour / On Duty": {
    description: [
      "## POST `/api/attendance/tour-duty`",
      "Employee applies for **On Tour** or **On Duty** date range.",
      "",
      "### When to use",
      "Official travel / client site / bank work instead of office punches.",
      "",
      "### Body fields",
      "| Field | Type | Required | Use |",
      "|-------|------|----------|-----|",
      "| `dutyType` | string | yes | `On Tour` or `On Duty` |",
      "| `tourCategory` | MongoId | yes | Master `_id` from **9a** or **9b** (not the name) |",
      "| `fromDate` / `toDate` | YYYY-MM-DD | yes | Inclusive range |",
      "| `fromTime` / `toTime` | HH:mm | yes | Window |",
      "| `reason` | string | yes | Why |",
      "| `remarks` | string | no | Extra |",
      "| `document` | URL | no | Upload with type `onTour` / `onDuty`, then put `url` here |",
      "",
      "### After review (1.7 → 5)",
      "- **Approve** → each covered day attendance **Present**",
      "- **Reject** → each covered day **Absent**",
      "Saves `{{tourDutyId}}`.",
      tip,
    ].join("\n"),
  },

  "10. My On Tour / On Duty": {
    description: [
      "## GET `/api/attendance/tour-duty`",
      "Own On Tour / On Duty applications.",
      "",
      "### Query",
      "| Param | Use |",
      "|-------|-----|",
      "| `status` | ALL \\| Pending \\| Approved \\| Rejected \\| Cancelled |",
      "| `month` | YYYY-MM optional filter |",
      "| `page` / `limit` | Pagination |",
      "",
      "`duration` = inclusive days, e.g. `3 Day(s)`.",
      tip,
    ].join("\n"),
  },

  "11. Cancel On Tour / On Duty": {
    description: [
      "## POST `/api/attendance/tour-duty/:id/cancel`",
      "Cancel **your own Pending** On Tour/On Duty request.",
      "",
      "Approved requests stay on attendance and cannot be cancelled here.",
      "Path: `{{tourDutyId}}` from apply or list.",
      tip,
    ].join("\n"),
  },

  // ── Admin folder ───────────────────────────────────────────
  "4. Attendance Regularization": {
    folder: [
      "## Attendance Regularization (approval queue)",
      "Employee creates requests in **2.2 Attendance (Punch)**:",
      "- **6** Missed punch → send missing `HH:mm`",
      "- **6b** Late → `date` + `reason` only",
      "- **6c** Break → break start/end + reason",
      "",
      "Login as **Reporting Manager** (own team), **HR** (assigned companies), or **Super Admin**.",
      "Employees **cannot** approve/reject (including their own).",
      "",
      "| Request type | On Approve | On Reject |",
      "|--------------|------------|-----------|",
      "| Missed punch | Saved times scored vs shift → Present/Late/HalfDay/Absent | Missed punch-out stays **MissedPunch** |",
      "| Late | Day stays **Late**, `attendanceStatus` = **Approved** | Day stays **Late**, `attendanceStatus` = **Rejected** |",
      "| Break | Break times written; hours recounted | Break unchanged |",
    ].join("\n"),
  },

  "1. List requests": {
    description: [
      "## GET `/api/attendance/regularizations`",
      "Approval inbox for regularization (scope by role).",
      "",
      "### Who sees what",
      "| Role | Scope |",
      "|------|-------|",
      "| Super Admin / Admin | Company (or first company if `companyId` omitted) |",
      "| HR | Assigned companies |",
      "| Reporting Manager | Own team only |",
      "",
      "### Query params",
      "| Param | Use |",
      "|-------|-----|",
      "| `companyId` | Optional company filter |",
      "| `status` | Pending (often default) \\| Approved \\| Rejected \\| Cancelled \\| ALL |",
      "| `search` | Name / email / employee code |",
      "| `from` / `to` | Attendance date range |",
      "| `page` / `limit` | Pagination |",
      "",
      "Test script saves first `_id` → `{{regularizationId}}`.",
      tip,
    ].join("\n"),
  },

  "2. Approve": {
    description: [
      "## POST `/api/attendance/regularizations/:id/review?decision=approve`",
      "Approve a Pending regularization.",
      "",
      "### Query / body",
      "| Field | Use |",
      "|-------|-----|",
      "| `decision` | Query: `approve` (also accepted in body) |",
      "| `reason` | Body **required** — reviewer note (min 1 char) |",
      "",
      "### Effects",
      "- **Missed punch:** apply proposed times → score day vs shift.",
      "- **Late:** keep status Late; set `attendanceStatus` Approved.",
      "- **Break:** write break; recount hours.",
      "Cannot approve your own request.",
      tip,
    ].join("\n"),
  },

  "3. Reject": {
    description: [
      "## POST `/api/attendance/regularizations/:id/review?decision=reject`",
      "Reject a Pending regularization.",
      "",
      "### Query / body",
      "| Field | Use |",
      "|-------|-----|",
      "| `decision` | Query: `reject` |",
      "| `reason` | Body **required** — why rejected |",
      "",
      "### Effects",
      "- **Late:** stays Late; `attendanceStatus` Rejected.",
      "- **Missed punch-out:** stays **MissedPunch**.",
      "- **Break:** unchanged.",
      "Employee cannot reject their own request.",
      tip,
    ].join("\n"),
  },
};

function walk(items, parentName) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const name = item.name || "";
    const doc = DOCS[name];
    if (doc) {
      if (doc.folder != null && item.item) {
        item.description = doc.folder;
      }
      if (doc.description != null && item.request) {
        item.request.description = doc.description;
      }
      // Special: admin "1. List requests" only under Regularization folder
      if (name === "1. List requests" && parentName !== "4. Attendance Regularization") {
        // skip overwrite if wrong folder — restore by only applying when parent matches
      }
    }
    if (item.item) walk(item.item, name);
  }
}

// More precise: only apply list/approve/reject docs under the regularization folder
function walkPrecise(items, ctx) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const name = item.name || "";
    const nextCtx = {
      inPunch: ctx.inPunch || name.includes("2.2 Attendance"),
      inReg:
        ctx.inReg ||
        name === "4. Attendance Regularization" ||
        (name.includes("Attendance Regularization") && item.item),
    };

    const doc = DOCS[name];
    if (doc) {
      if (doc.folder != null && item.item) {
        item.description = doc.folder;
      }
      if (doc.description != null && item.request) {
        const isAdminOnly =
          name === "1. List requests" || name === "2. Approve" || name === "3. Reject";
        if (!isAdminOnly || nextCtx.inReg) {
          item.request.description = doc.description;
        }
      }
    }
    if (item.item) walkPrecise(item.item, nextCtx);
  }
}

walkPrecise(c.item, { inPunch: false, inReg: false });

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("Updated attendance docs in", path.basename(file));
