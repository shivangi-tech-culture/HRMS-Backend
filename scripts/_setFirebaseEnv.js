/**
 * One-shot: write Firebase Admin SDK creds into .env (gitignored).
 * Usage: node scripts/_setFirebaseEnv.js <path-to-serviceAccount.json>
 */
const fs = require("fs");
const path = require("path");

const saPath = process.argv[2];
if (!saPath || !fs.existsSync(saPath)) {
  console.error("Usage: node scripts/_setFirebaseEnv.js <serviceAccount.json>");
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, "utf8"));
const envPath = path.join(__dirname, "..", ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

const keys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
];

env = env
  .split(/\r?\n/)
  .filter((line) => !keys.some((k) => line.startsWith(`${k}=`)))
  .join("\n")
  .replace(/\n+$/, "\n");

const privateKeyEscaped = String(sa.private_key).replace(/\n/g, "\\n");

const block = [
  "",
  "# Firebase Cloud Messaging (Admin SDK) — local only, never commit",
  `FIREBASE_PROJECT_ID=${sa.project_id}`,
  `FIREBASE_CLIENT_EMAIL=${sa.client_email}`,
  `FIREBASE_PRIVATE_KEY="${privateKeyEscaped}"`,
  "",
].join("\n");

fs.writeFileSync(envPath, env + block);
console.log("OK — Firebase Admin env written for", sa.project_id);
console.log("Restart the API server to load FCM.");
