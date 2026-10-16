const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");

function secretKey() {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) {
    const err = new Error("JWT_SECRET is required to store an email app password");
    err.status = 500;
    throw err;
  }
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/** Google shows app passwords in groups of four; the spaces are not part of the password. */
function cleanAppPassword(value) {
  return String(value || "").replace(/\s+/g, "");
}

function sealAppPassword(value) {
  const plain = cleanAppPassword(value);
  if (!plain) return { emailAppPassword: "", emailAppPasswordSet: false };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    emailAppPassword: `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`,
    emailAppPasswordSet: true,
  };
}

function openAppPassword(stored) {
  const raw = String(stored || "");
  if (!raw) return "";
  if (!raw.startsWith("v1:")) return raw;
  const [, ivB64, tagB64, dataB64] = raw.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function googleMailDomains() {
  const extra = String(process.env.GOOGLE_MAIL_DOMAINS || "techculture.ai")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return new Set(["gmail.com", "googlemail.com", ...extra]);
}

function serversFor(email) {
  const domain = String(email.split("@")[1] || "").toLowerCase();
  if (googleMailDomains().has(domain)) {
    return { smtp: "smtp.gmail.com", imap: "imap.gmail.com" };
  }
  return {
    smtp: process.env.SMTP_HOST_EZ || "smtp.zoho.com",
    imap: process.env.IMAP_HOST_EZ || "imap.zoho.com",
  };
}

function credsFromRow(row) {
  const email = String(row?.official?.officialEmail || "").trim().toLowerCase();
  const password = cleanAppPassword(openAppPassword(row?.official?.emailAppPassword));
  if (!row || !email || !password) return null;
  return {
    userId: String(row._id),
    name: row.name || email,
    email,
    password,
    ...serversFor(email),
  };
}

async function loadMailboxCreds(userId) {
  const row = await User.findById(userId).select(
    "name official.officialEmail official.emailAppPassword official.emailAppPasswordSet",
  );
  return credsFromRow(row);
}

/** Same lookup by official email, so the local SMTP bridge can send as that employee. */
async function loadMailboxCredsByEmail(email, Model = User) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const row = await Model.findOne({ "official.officialEmail": normalized }).select(
    "name official.officialEmail official.emailAppPassword official.emailAppPasswordSet",
  );
  try {
    return credsFromRow(row);
  } catch {
    const err = new Error("This computer cannot read the saved app password. Save it again in General Info.");
    err.status = 400;
    throw err;
  }
}

async function sendAsUser(creds, { to, subject, text, attachments, messageId }) {
  const transporter = nodemailer.createTransport({
    host: creds.smtp,
    port: Number(process.env.SMTP_PORT_EZ) || 465,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  return transporter.sendMail({
    from: `"${creds.name}" <${creds.email}>`,
    to,
    subject: subject || "(no subject)",
    text: text || "",
    attachments: attachments?.length ? attachments : undefined,
    messageId,
  });
}

async function openImap(creds) {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: creds.imap,
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  await client.connect();
  return client;
}

/** Log in to the mailbox and out again, so a wrong app password is reported right away. */
async function checkMailboxLogin(userId) {
  const creds = await loadMailboxCreds(userId);
  if (!creds) return false;
  const client = await openImap(creds);
  await client.logout().catch(() => {});
  return true;
}

/**
 * Mailbox mail used to be copied into MongoDB (rfcMessageId was only set by that copy).
 * Mail is now read live from the mailbox, so those copies are removed.
 */
async function purgeImportedMail() {
  const MailMessage = require("../models/MailMessage");
  const Mailbox = require("../models/Mailbox");
  const ids = await MailMessage.find({ rfcMessageId: { $nin: ["", null] } }).distinct("_id");
  if (!ids.length) return 0;
  await Mailbox.deleteMany({ messageId: { $in: ids } });
  await MailMessage.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

module.exports = {
  sealAppPassword,
  loadMailboxCreds,
  loadMailboxCredsByEmail,
  sendAsUser,
  openImap,
  checkMailboxLogin,
  purgeImportedMail,
};
