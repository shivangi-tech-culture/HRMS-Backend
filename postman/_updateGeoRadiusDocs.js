/**
 * Update Postman collection for 50m geofence + Kailash office lat/long.
 * Run: node postman/_updateGeoRadiusDocs.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "HRMS_API.postman_collection.json");
const c = JSON.parse(fs.readFileSync(file, "utf8"));

/** TechCulture Kailash Building — within 50m for tests (~10m north of office) */
const OFFICE = {
  latitude: 28.6294351,
  longitude: 77.2222984,
  address: "1212 KAILASH BUILDING KG MARG NEW DELHI CENTRAL DELHI DELHI 110001 INDIA",
  city: "New Delhi",
  state: "Delhi",
  pincode: "110001",
};

const punchBody = {
  source: "web",
  latitude: OFFICE.latitude,
  longitude: OFFICE.longitude,
  remarks: "Reached office",
};

const punchOutBody = {
  source: "web",
  latitude: OFFICE.latitude,
  longitude: OFFICE.longitude,
  remarks: "",
};

const breakBody = {
  latitude: OFFICE.latitude,
  longitude: OFFICE.longitude,
};

const PUNCH_IN_DOC = [
  "## POST `/api/attendance/punch-in`",
  "Start the work day. GPS must be **within 50 m** of the assigned branch office.",
  "",
  "### Body",
  "| Field | Type | Required | Use |",
  "|-------|------|----------|-----|",
  "| `source` | string | yes | `web` \\| `mobile` \\| `biometric` |",
  "| `latitude` | number | yes | Device GPS lat (−90…90) |",
  "| `longitude` | number | yes | Device GPS lng (−180…180) |",
  "| `remarks` | string | no | Optional note (max 500) |",
  "",
  "### Geofence (50 m)",
  "- Office lat/long come from **company branch** (saved from address via Map API, or set on company).",
  "- TechCulture test office (Kailash Building): `28.6293453, 77.2222984`.",
  "- Sample body below is ~**10 m** from office → **accept**.",
  "- Outside 50 m → `400` with `distanceMeters`, `distanceKm`, `allowedRadiusMeters`.",
  "- On Tour / On Duty (approved) → radius skipped.",
  "",
  "### Success also returns",
  "`distanceMeters`, `distanceKm`, `allowedRadiusMeters` (how far you were when accepted).",
  "",
  "### Day status",
  "- Until punch-out: `MissedPunch`.",
  "- `attendanceStatus`: Early | On time | Late.",
  "",
  "Saves `{{attendanceId}}`. Header: `Authorization: Bearer {{token}}`",
].join("\n");

const PUNCH_OUT_DOC = [
  "## POST `/api/attendance/punch-out`",
  "End the work day. Same **50 m** geofence as punch-in.",
  "",
  "### Body",
  "| Field | Type | Required | Use |",
  "|-------|------|----------|-----|",
  "| `source` | string | yes | `web` \\| `mobile` \\| `biometric` |",
  "| `latitude` | number | yes | Device GPS lat |",
  "| `longitude` | number | yes | Device GPS lng |",
  "| `remarks` | string | no | Optional note |",
  "",
  "### Geofence",
  "Must be within **50 m** of branch office GPS (Kailash sample coords in body).",
  "Reject payload includes meters + km. Success includes distance used.",
  "",
  "Must already be punched in. End open break before punch-out.",
  "",
  "Header: `Authorization: Bearer {{token}}`",
].join("\n");

const BREAK_START_DOC = [
  "## POST `/api/break/start`",
  "Start next break (auto type). **latitude + longitude required** — same **50 m** office radius as punch.",
  "",
  "### Body",
  "```json",
  JSON.stringify(breakBody, null, 2),
  "```",
  "- Do **not** send `breakType` (ignored; auto Lunch/Tea → Day Break if granted).",
  "- Outside 50 m → same distance error as punch.",
  "",
  "Punch in first. One open break at a time. Saves `{{breakId}}`.",
].join("\n");

const BREAK_END_DOC = [
  "## POST `/api/break/end`",
  "End open break. **latitude + longitude required** — within **50 m** of branch office.",
  "",
  "### Body",
  "```json",
  JSON.stringify(breakBody, null, 2),
  "```",
  "",
  "Response: break minutes + attendance worked / required / remaining.",
].join("\n");

const walk = (items, fn) => {
  for (const it of items || []) {
    fn(it);
    if (it.item) walk(it.item, fn);
  }
};

const setJsonBody = (req, obj) => {
  req.header = req.header || [];
  if (!req.header.some((h) => String(h.key).toLowerCase() === "content-type")) {
    req.header.push({ key: "Content-Type", value: "application/json" });
  }
  req.body = {
    mode: "raw",
    raw: JSON.stringify(obj, null, 2),
    options: { raw: { language: "json" } },
  };
};

const patchBranchGeo = (raw) => {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(body.branches)) return raw;
  body.branches = body.branches.map((b, idx) => ({
    ...b,
    address: idx === 0 ? OFFICE.address : b.address || OFFICE.address,
    city: idx === 0 ? OFFICE.city : b.city || OFFICE.city,
    state: idx === 0 ? OFFICE.state : b.state || OFFICE.state,
    pincode: idx === 0 ? OFFICE.pincode : b.pincode || OFFICE.pincode,
    latitude: OFFICE.latitude,
    longitude: OFFICE.longitude,
  }));
  return JSON.stringify(body, null, 2);
};

let n = 0;

walk(c.item, (it) => {
  const req = it.request;
  if (!req?.url) return;
  const rawUrl = typeof req.url === "string" ? req.url : req.url.raw || "";

  if (rawUrl.includes("/attendance/punch-in") && req.method === "POST") {
    req.description = PUNCH_IN_DOC;
    setJsonBody(req, punchBody);
    n += 1;
  }

  if (rawUrl.includes("/attendance/punch-out") && req.method === "POST") {
    req.description = PUNCH_OUT_DOC;
    setJsonBody(req, punchOutBody);
    n += 1;
  }

  if (rawUrl.includes("/break/start") && req.method === "POST") {
    req.description = BREAK_START_DOC;
    setJsonBody(req, breakBody);
    n += 1;
  }

  if (rawUrl.includes("/break/end") && req.method === "POST") {
    req.description = BREAK_END_DOC;
    setJsonBody(req, breakBody);
    n += 1;
  }

  if (
    (rawUrl.includes("/api/companies") || rawUrl.match(/\/companies\/\{\{/)) &&
    (req.method === "POST" || req.method === "PUT") &&
    req.body?.raw &&
    req.body.raw.includes("branches")
  ) {
    const next = patchBranchGeo(req.body.raw);
    if (next !== req.body.raw) {
      req.body.raw = next;
      n += 1;
      const geoNote =
        "\n\n### Branch GPS (50 m punch/break geofence)\n" +
        "- `branches[].latitude` / `longitude` — optional numbers; if omitted, server geocodes from `address`+`city`+`state`+`pincode`.\n" +
        "- Sample uses **Kailash Building** coords for TechCulture-style tests.";
      if (req.description && !req.description.includes("Branch GPS")) {
        req.description += geoNote;
      }
    }
  }
});

// Collection variables for quick copy
const vars = c.variable || [];
const upsertVar = (key, value, description) => {
  const existing = vars.find((v) => v.key === key);
  if (existing) {
    existing.value = String(value);
    if (description) existing.description = description;
  } else {
    vars.push({ key, value: String(value), description: description || "" });
  }
};
upsertVar("officeLatitude", OFFICE.latitude, "Kailash Building lat — punch/break within 50m");
upsertVar("officeLongitude", OFFICE.longitude, "Kailash Building lng — punch/break within 50m");
c.variable = vars;

fs.writeFileSync(file, JSON.stringify(c, null, 2));
console.log(`Updated ${n} request(s) + officeLatitude/officeLongitude variables.`);
console.log(`Sample punch/break GPS: ${OFFICE.latitude}, ${OFFICE.longitude} (~10m from office)`);
