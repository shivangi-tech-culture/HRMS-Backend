/**
 * Firebase Cloud Messaging (FCM) — web + Android + iOS push
 *
 * Env (pick ONE style):
 *   A) FIREBASE_SERVICE_ACCOUNT_JSON = full service-account JSON string
 *   B) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *
 * Frontend also needs FIREBASE_WEB_VAPID_KEY (Web Push certificates in Firebase Console).
 */
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

let ready = false;
let initError = "";

const parseServiceAccount = () => {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (parsed.private_key) {
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    }
    return parsed;
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  let privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (!projectId || !clientEmail || !privateKey) return null;

  privateKey = privateKey.replace(/\\n/g, "\n");
  return {
    type: "service_account",
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
};

const initFirebase = () => {
  if (ready) return true;
  if (getApps().length) {
    ready = true;
    return true;
  }

  try {
    const sa = parseServiceAccount();
    if (!sa) {
      initError =
        "Firebase not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY";
      return false;
    }
    initializeApp({
      credential: cert(sa),
      projectId: sa.project_id,
    });
    ready = true;
    initError = "";
    return true;
  } catch (err) {
    initError = err.message || "Firebase init failed";
    ready = false;
    return false;
  }
};

const isFcmReady = () => initFirebase();

const fcmStatus = () => ({
  configured: isFcmReady(),
  error: ready ? "" : initError,
  webVapidKeySet: Boolean(String(process.env.FIREBASE_WEB_VAPID_KEY || "").trim()),
});

/**
 * Send one notification to many FCM tokens.
 * Removes invalid tokens from the returned `invalidTokens` list.
 */
const sendToTokens = async ({ tokens, title, body, data = {} }) => {
  if (!isFcmReady()) {
    return {
      ok: false,
      successCount: 0,
      failureCount: tokens?.length || 0,
      invalidTokens: [],
      error: initError || "FCM not ready",
    };
  }

  const list = [...new Set((tokens || []).map((t) => String(t || "").trim()).filter(Boolean))];
  if (!list.length) {
    return { ok: true, successCount: 0, failureCount: 0, invalidTokens: [], error: "" };
  }

  const dataStr = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined || v === null) continue;
    dataStr[String(k)] = typeof v === "string" ? v : JSON.stringify(v);
  }

  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;
  const messaging = getMessaging();

  const chunkSize = 500;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data: dataStr,
      webpush: {
        notification: { title, body },
      },
      android: {
        priority: "high",
        notification: { title, body, sound: "default" },
      },
      apns: {
        payload: {
          aps: { alert: { title, body }, sound: "default" },
        },
      },
    });

    successCount += res.successCount;
    failureCount += res.failureCount;

    res.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error?.code || "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token") ||
        code.includes("invalid-argument")
      ) {
        invalidTokens.push(chunk[idx]);
      }
    });
  }

  return {
    ok: failureCount === 0,
    successCount,
    failureCount,
    invalidTokens,
    error: "",
  };
};

module.exports = {
  initFirebase,
  isFcmReady,
  fcmStatus,
  sendToTokens,
};
