const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");

const syncedAt = new Map();

function secretKey() {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) {
    const err = new Error("JWT_SECRET is required to store an email app password");
    err.status = 500;
    throw err;
  }
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function sealAppPassword(value) {
  const plain = String(value || "").trim();
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

function serversFor(email) {
  const domain = String(email.split("@")[1] || "").toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { smtp: "smtp.gmail.com", imap: "imap.gmail.com" };
  }
  return {
    smtp: process.env.SMTP_HOST_EZ || "smtp.zoho.com",
    imap: process.env.IMAP_HOST_EZ || "imap.zoho.com",
  };
}

async function loadMailboxCreds(userId) {
  const row = await User.findById(userId).select(
    "name official.officialEmail official.emailAppPassword official.emailAppPasswordSet",
  );
  const email = String(row?.official?.officialEmail || "").trim().toLowerCase();
  const password = openAppPassword(row?.official?.emailAppPassword);
  if (!row || !email || !password) return null;
  return {
    userId: String(row._id),
    name: row.name || email,
    email,
    password,
    ...serversFor(email),
  };
}

async function sendAsUser(creds, { to, subject, text, attachments }) {
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
  });
}

function textOf(parsed) {
  const text = String(parsed?.text || "").trim();
  if (text) return text.slice(0, 20000);
  return String(parsed?.html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

function addressList(list) {
  return (list || [])
    .map((item) => ({
      name: item.name || item.address || "",
      email: String(item.address || "").trim().toLowerCase(),
    }))
    .filter((item) => item.email);
}

async function importParsed(ownerId, folder, parsed) {
  const MailMessage = require("../models/MailMessage");
  const Mailbox = require("../models/Mailbox");
  const rfcMessageId = String(parsed.messageId || "").trim();
  if (!rfcMessageId) return;
  const from = addressList(parsed.from?.value)[0] || { name: "", email: "" };
  if (!from.email) return;
  const to = addressList(parsed.to?.value);
  const body = textOf(parsed);
  const names = (parsed.attachments || []).map((file) => file.filename).filter(Boolean);
  const bodyWithFiles = names.length ? `${body}\n\nAttachments: ${names.join(", ")}`.trim() : body;

  let message = await MailMessage.findOne({ rfcMessageId });
  if (!message) {
    const person = from.email
      ? await User.findOne({ "official.officialEmail": from.email }).select("_id name").lean()
      : null;
    message = await MailMessage.create({
      rfcMessageId,
      fromEmployeeId: person ? String(person._id) : "",
      fromName: from.name || person?.name || from.email,
      fromEmail: from.email,
      to: to.map((item) => ({
        employeeId: "",
        name: item.name,
        email: item.email,
        kind: "external",
      })),
      subject: String(parsed.subject || "").trim() || "(no subject)",
      body: bodyWithFiles,
      preview: bodyWithFiles.replace(/\s+/g, " ").trim().slice(0, 140) || "(no subject)",
      externalStatus: "sent",
    });
  }

  const existing = await Mailbox.findOne({ ownerId, messageId: message._id });
  if (existing) return false;
  await Mailbox.create({
    ownerId,
    messageId: message._id,
    folder,
    unread: folder === "inbox",
    starred: false,
  });
  return true;
}

async function readFolder(client, mailbox, ownerId, folder, limit) {
  const { simpleParser } = require("mailparser");
  const lock = await client.getMailboxLock(mailbox);
  let imported = 0;
  try {
    const status = await client.status(mailbox, { messages: true });
    const total = Number(status.messages) || 0;
    if (!total) return 0;
    const start = Math.max(1, total - limit + 1);
    for await (const msg of client.fetch(`${start}:*`, { source: true, uid: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      if (await importParsed(ownerId, folder, parsed)) imported += 1;
    }
  } finally {
    lock.release();
  }
  return imported;
}

async function syncUserMailbox(userId, { force = false } = {}) {
  const last = syncedAt.get(String(userId)) || 0;
  if (!force && Date.now() - last < 45_000) return { ok: true, skipped: true, imported: 0 };
  const limit = force ? 50 : 20;
  const creds = await loadMailboxCreds(userId);
  if (!creds) return { ok: false, skipped: true, imported: 0 };
  syncedAt.set(String(userId), Date.now());
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
  let imported = 0;
  try {
    imported += await readFolder(client, "INBOX", creds.userId, "inbox", limit);
    const boxes = await client.list();
    const sent = boxes.find((box) =>
      /\\sent/i.test(String(box.specialUse || "")) || /sent/i.test(box.path),
    );
    if (sent?.path) imported += await readFolder(client, sent.path, creds.userId, "sent", limit);
  } finally {
    await client.logout().catch(() => {});
  }
  return { ok: true, imported };
}

module.exports = {
  sealAppPassword,
  loadMailboxCreds,
  sendAsUser,
  syncUserMailbox,
};
