/**
 * Login bodies + docs: optional fcmToken on login (JWT response unchanged).
 * Run: node postman/_updateLoginFcmDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

const FCM_LOGIN_NOTE = `
### FCM on login (web + app) — preferred
Send device token **in the same login body**. Response stays **JWT only**.
\`\`\`json
{
  "username": "shivangi@techculture.ai",
  "password": "TC00415012005",
  "fcmToken": "{{fcmToken}}",
  "platform": "android",
  "deviceId": "employee-phone-1"
}
\`\`\`
- \`platform\`: \`web\` | \`android\` | \`ios\`
- No separate register call needed on every login.
- Optional later: \`POST /api/notifications/token\` only if FCM refreshes without re-login.
`;

function walk(items, fn) {
  for (const it of items || []) {
    fn(it);
    if (it.item) walk(it.item, fn);
  }
}

function upsertFcmOnLoginBody(raw) {
  try {
    const o = JSON.parse(raw);
    if (o.fcmToken !== undefined) return JSON.stringify(o, null, 2);
    o.fcmToken = "{{fcmToken}}";
    o.platform = o.platform || "android";
    o.deviceId = o.deviceId || "device-1";
    return JSON.stringify(o, null, 2);
  } catch {
    return raw;
  }
}

walk(c.item, (it) => {
  const raw = it.request?.url?.raw || "";
  if (!it.request || !raw.includes("/api/auth/login")) return;
  if (!(it.name || "").toLowerCase().includes("login")) return;
  const desc = String(it.request.description || "");
  if (!desc.includes("FCM on login")) {
    it.request.description = desc.replace(/\s*$/, "") + FCM_LOGIN_NOTE;
  }
  if (it.request.body?.raw) {
    it.request.body.raw = upsertFcmOnLoginBody(it.request.body.raw);
  }
});

walk(c.item, (it) => {
  if (it.name !== "2.1b Notifications (accept web + app)") return;
  it.description = [
    "## Employee notifications (web + app)",
    "",
    "### How to accept / enable push",
    "1. Firebase SDK → get FCM token + user allows notifications",
    "2. **Login** with `fcmToken` + `platform` + `deviceId` in body (same call as JWT)",
    "3. List / mark read below",
    "",
    "Login response = **JWT only**. FCM is saved on the user document.",
    "",
    "| Platform | platform value |",
    "|----------|----------------|",
    "| Browser | `web` |",
    "| Android | `android` |",
    "| iOS | `ios` |",
    "",
    "Optional: **Refresh FCM Token** only if token changes without a new login.",
  ].join("\n");
  if (it.item?.[0]) {
    it.item[0].name = "1. Optional — Refresh FCM Token (no re-login)";
    it.item[0].request.description = [
      "## POST `/api/notifications/token` (optional)",
      "Prefer `fcmToken` on **login**. Use this only when Firebase refreshes the device token while still logged in.",
      "",
      "---",
      "**Header:** `Authorization: Bearer {{token}}`",
      "**Body:** `token`, `platform`, `deviceId`",
      "---",
    ].join("\n");
  }
});

walk(c.item, (it) => {
  if (it.name !== "1.12 Notifications (FCM)") return;
  it.description = [
    "## Notifications",
    "",
    "**Preferred:** web/app send `fcmToken` on `POST /api/auth/login` (JWT response unchanged).",
    "",
    "1. Optional refresh: `POST /token`",
    "2. `GET /` list (scoped)",
    "3. `PUT /:id/read`",
    "",
    "Punch-in `< 70%` → `403 PROFILE_INCOMPLETE` + FCM if token was saved at login.",
  ].join("\n");
});

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("OK — login FCM docs + bodies updated");
