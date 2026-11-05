/**
 * Strip FCM fields from login bodies/docs.
 * FCM register only via POST /api/notifications/token after login.
 * Run: node postman/_updateLoginFcmDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

function walk(items, fn) {
  for (const it of items || []) {
    fn(it);
    if (it.item) walk(it.item, fn);
  }
}

function stripFcmFromLoginBody(raw) {
  try {
    const o = JSON.parse(raw);
    delete o.fcmToken;
    delete o.platform;
    delete o.deviceId;
    return JSON.stringify(o, null, 2);
  } catch {
    return raw;
  }
}

function stripFcmFromLoginDescription(desc) {
  let d = String(desc || "");
  d = d.replace(/\n### FCM on login[\s\S]*?(?=\n### |\n---|\n\*\*Use local|$)/, "\n");
  d = d.replace(
    /\n### Body fields[\s\S]*?(?=\n\*\*Use local|\n---|\n_Tip:|$)/,
    "\n### Body fields\n| Field | Required | Use |\n|-------|----------|-----|\n| `username` | yes | email / employee code / mobile |\n| `password` | yes | login password |\n\nLogin returns JWT only. Register FCM after login via `POST /api/notifications/token`.\n"
  );
  return d.replace(/\n{3,}/g, "\n\n").trim();
}

walk(c.item, (it) => {
  const raw = it.request?.url?.raw || "";
  if (!it.request || !raw.includes("/api/auth/login")) return;
  if (!(it.name || "").toLowerCase().includes("login")) return;
  if (it.request.description) {
    it.request.description = stripFcmFromLoginDescription(it.request.description);
  }
  if (it.request.body?.raw) {
    it.request.body.raw = stripFcmFromLoginBody(it.request.body.raw);
  }
});

walk(c.item, (it) => {
  if (it.name !== "2.1b Notifications (accept web + app)") return;
  it.description = [
    "## Employee — enable notifications (web + app)",
    "",
    "1. Login (`username` + `password`) → JWT",
    "2. Firebase SDK → get FCM token (user allows notifications)",
    "3. **Register Token** `POST /api/notifications/token`",
    "4. **My Notifications** / **Mark Read** below",
    "",
    "| Platform | platform value |",
    "|----------|----------------|",
    "| Browser | `web` |",
    "| Android | `android` |",
    "| iOS | `ios` |",
    "",
    "Seed: `shivangi@techculture.ai` / `TC00415012005`.",
  ].join("\n");
  if (it.item?.[0]) {
    it.item[0].name = "1. Register FCM Token";
    it.item[0].request.description = [
      "## POST `/api/notifications/token`",
      "Call **after login** to save the device FCM token on `User.fcmTokens`.",
      "",
      "Same `deviceId` replaces the previous token for that device.",
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
    "1. Login → JWT",
    "2. `POST /token` — register FCM (required for push)",
    "3. `GET /` list (scoped)",
    "4. `PUT /:id/read`",
    "",
    "Punch-in `< 70%` → `403 PROFILE_INCOMPLETE` + FCM if token was registered.",
  ].join("\n");
});

fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("OK — FCM removed from login bodies/docs");
