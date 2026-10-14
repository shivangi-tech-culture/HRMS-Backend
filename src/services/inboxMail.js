const crypto = require("crypto");
const MailComposer = require("nodemailer/lib/mail-composer");
const Mailbox = require("../models/Mailbox");
const MailMessage = require("../models/MailMessage");
const User = require("../models/User");
const { storeInboxFiles, removeChatFiles, readChatFile } = require("../utils/chatFiles");
const { loadMailboxCreds, sendAsUser, checkMailboxLogin } = require("../utils/userMailbox");
const live = require("../utils/liveMailbox");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function mailActor(user) {
  const email = String(user?.official?.officialEmail || "").trim().toLowerCase();
  if (!email) throw httpError(400, "Login user has no official email");
  return {
    employeeId: String(user._id),
    name: user.name || email,
    email,
    companyName: "",
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findByEmail(email) {
  const row = await User.findOne({
    "official.officialEmail": new RegExp(`^${escapeRegex(email)}$`, "i"),
  })
    .select("name official.officialEmail")
    .lean();
  if (!row?.official?.officialEmail) return null;
  return {
    employeeId: String(row._id),
    name: row.name || email,
    email: String(row.official.officialEmail).trim().toLowerCase(),
  };
}

function keptAttachmentIds(value, existing) {
  if (value == null) return new Set((existing || []).map((file) => String(file._id)));
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return new Set(raw.map((item) => String(item).trim()).filter(Boolean));
}

function attachmentCopies(files) {
  return (files || []).map((file) => ({
    name: file.name,
    size: file.size || 0,
    mimeType: file.mimeType,
    storageKey: file.storageKey,
  }));
}

function previewOf(body) {
  return String(body || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function initials(name, email) {
  const source = String(name || email || "").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function parseAddresses(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,;]/);
  const seen = new Set();
  const emails = [];
  for (const item of raw) {
    const email = String(item || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!EMAIL_RE.test(email)) throw httpError(400, `Invalid email: ${String(item).trim()}`);
    seen.add(email);
    emails.push(email);
  }
  if (emails.length > 50) throw httpError(400, "A mail can have at most 50 recipients");
  return emails;
}

async function resolveAddresses(emails) {
  const resolved = [];
  for (const email of emails) {
    const person = await findByEmail(email);
    if (person?.employeeId) {
      resolved.push({
        employeeId: person.employeeId,
        name: person.name || email,
        email: person.email,
        kind: "internal",
      });
    } else {
      resolved.push({ employeeId: "", name: email, email, kind: "external" });
    }
  }
  return resolved;
}

function toLine(addresses) {
  return {
    toName: addresses.map((item) => item.name || item.email).join(", "),
    toEmail: addresses.map((item) => item.email).join(", "),
  };
}

function toMailDto(box, message) {
  const addresses = Array.isArray(message.to) ? message.to : [];
  const line = toLine(addresses);
  return {
    id: String(box._id),
    messageId: String(message._id),
    folder: box.folder,
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    toName: line.toName,
    toEmail: line.toEmail,
    subject: message.subject,
    preview: message.preview,
    body: message.body,
    createdAt: message.createdAt,
    unread: box.unread,
    starred: box.starred,
    avatarInitials: initials(message.fromName, message.fromEmail),
    avatarUrl: "",
    company: message.companyName || "",
    attachments: (message.attachments || []).map((file) => ({
      id: String(file._id),
      name: file.name,
      size: file.size || 0,
      mimeType: file.mimeType || "",
    })),
    externalStatus: message.externalStatus || "none",
    externalError: message.externalError || "",
    snoozedUntil: box.snoozedUntil || null,
    reminderAt: box.reminderAt || null,
    task: box.task?.title
      ? { title: box.task.title, dueAt: box.task.dueAt || null, done: box.task.done === true }
      : null,
  };
}

function pushMail(req, ownerId, mail) {
  const io = req.app.get("io");
  if (io && ownerId) io.to(`user:${ownerId}`).emit("mail:new", mail);
}

async function loadOwned(user, mailboxId) {
  const box = await Mailbox.findOne({ _id: mailboxId, ownerId: user.employeeId });
  if (!box) throw httpError(404, "Mail not found");
  const message = await MailMessage.findById(box.messageId);
  if (!message) throw httpError(404, "Mail not found");
  return { box, message };
}

/** HRMS mail belongs to the address it was sent from or to, so an old official email's mail stays hidden. */
function forCurrentAddress(box, message, email) {
  if (box.folder === "drafts") return true;
  if (String(message.fromEmail || "").toLowerCase() === email) return true;
  return (message.to || []).some((item) => String(item.email || "").toLowerCase() === email);
}

async function listMessages(user, { folder = "inbox", q = "" } = {}) {
  const filter = { ownerId: user.employeeId };
  if (folder === "starred") {
    filter.starred = true;
    filter.folder = { $ne: "trash" };
  } else if (folder === "unread") {
    filter.unread = true;
    filter.folder = "inbox";
  } else if (folder === "all") {
    filter.folder = { $ne: "trash" };
  } else if (["inbox", "sent", "drafts", "trash"].includes(folder)) {
    filter.folder = folder;
  } else {
    throw httpError(400, "Unknown folder");
  }

  const [boxes, gmail, owned] = await Promise.all([
    Mailbox.find(filter).sort({ createdAt: -1 }).limit(200),
    folder === "drafts" ? [] : live.liveMessages(user.employeeId, folder),
    Mailbox.find({ ownerId: user.employeeId }).distinct("messageId"),
  ]);
  const ownedIds = new Set(owned.map(String));
  const mailbox = gmail.filter((mail) => !mail.hrmsMessageId || !ownedIds.has(mail.hrmsMessageId));
  const messages = await MailMessage.find({ _id: { $in: boxes.map((box) => box.messageId) } });
  const byId = new Map(messages.map((message) => [String(message._id), message]));
  const query = String(q || "").trim().toLowerCase();

  const hrms = boxes
    .map((box) => {
      const message = byId.get(String(box.messageId));
      if (!message || !forCurrentAddress(box, message, user.email)) return null;
      return toMailDto(box, message);
    })
    .filter(Boolean);

  return [...hrms, ...mailbox]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((mail) => {
      if (!query) return true;
      return [mail.subject, mail.fromName, mail.toName, mail.preview, mail.fromEmail, mail.toEmail]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
}

async function folderCounts(user) {
  const rows = [
    ...(await listMessages(user, { folder: "all" })),
    ...(await listMessages(user, { folder: "trash" })),
    ...(await listMessages(user, { folder: "drafts" })),
  ];
  const counts = { inbox: 0, drafts: 0, sent: 0, starred: 0, trash: 0, unread: 0 };
  for (const mail of rows) {
    if (counts[mail.folder] !== undefined) counts[mail.folder] += 1;
    if (mail.starred && mail.folder !== "trash") counts.starred += 1;
    if (mail.unread && mail.folder === "inbox") counts.unread += 1;
  }
  return counts;
}

function hrmsOnly(id, action) {
  if (live.isLiveId(id)) throw httpError(400, `${action} works on HRMS mail only, not on Gmail mail`);
}

async function mailFiles(message) {
  const attachments = [];
  for (const file of message.attachments || []) {
    const content = await readChatFile(file.storageKey);
    attachments.push({ filename: file.name, content, contentType: file.mimeType });
  }
  return attachments;
}

/** Returns the error shown to the sender, and whether Gmail SMTP really sent the mail. */
async function deliverExternal(message, user) {
  const recipients = (message.to || [])
    .map((item) => item.email)
    .filter((email) => email && email !== user.email);
  const done = async (status, error, smtp = false) => {
    message.externalStatus = status;
    message.externalError = error;
    await message.save();
    return { error, smtp };
  };
  if (!recipients.length) return done("none", "");
  const outside = (message.to || []).filter(
    (item) => item.kind === "external" && item.email && item.email !== user.email,
  );
  if (process.env.RENDER === "true" && !outside.length) return done("sent", "");
  if (process.env.RENDER === "true") {
    return done(
      "failed",
      "Live server cannot reach Gmail SMTP, so this address did not receive the mail. It is saved in HRMS.",
    );
  }
  const creds = await loadMailboxCreds(user.employeeId);
  if (!creds) return done("failed", "Save your email app password in General Info before sending mail");
  try {
    await sendAsUser(creds, {
      to: recipients,
      subject: message.subject || "(no subject)",
      text: message.body || "",
      attachments: await mailFiles(message),
      messageId: `<hrms-${message._id}@hrms.mail>`,
    });
    return done("sent", "", true);
  } catch (err) {
    return done("failed", err.message || "Mailbox send failed");
  }
}

/**
 * Without SMTP the mail only exists in HRMS. Put a copy straight into the sender's Sent
 * and each HRMS recipient's Inbox over IMAP, so it shows in their Gmail app too.
 * Only works for people who saved an app password.
 */
async function copyToMailboxes(message, senderId, ownerIds) {
  try {
    const raw = await new MailComposer({
      from: { name: message.fromName, address: message.fromEmail },
      to: (message.to || []).map((item) => ({ name: item.name || item.email, address: item.email })),
      subject: message.subject || "(no subject)",
      text: message.body || "",
      date: message.createdAt,
      messageId: `<hrms-${message._id}@hrms.mail>`,
      attachments: await mailFiles(message),
    })
      .compile()
      .build();
    const jobs = [
      live.appendLive(senderId, "sent", raw, { seen: true, date: message.createdAt }),
      ...ownerIds.map((id) => live.appendLive(id, "inbox", raw, { date: message.createdAt })),
    ];
    const results = await Promise.allSettled(jobs);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Mailbox copy failed:", result.reason?.responseText || result.reason?.message);
      }
    }
  } catch (err) {
    console.error("Mailbox copy failed:", err.message);
  }
}

async function sendMail(user, input, req) {
  const emails = parseAddresses(input.to);
  if (!emails.length) throw httpError(400, "To is required");
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  const incoming = Array.isArray(input.files) ? input.files : [];
  if (!subject) throw httpError(400, "Subject is required");
  if (!body && !incoming.length && input.keepAttachmentIds == null) {
    throw httpError(400, "Message or an attachment is required");
  }

  let reused = [];
  let dropped = [];
  let draftBox = null;
  let draftMessage = null;
  if (input.draftId) {
    const loaded = await loadOwned(user, String(input.draftId));
    if (loaded.box.folder !== "drafts") throw httpError(400, "This mail is not a draft");
    draftBox = loaded.box;
    draftMessage = loaded.message;
    const keep = keptAttachmentIds(input.keepAttachmentIds, draftMessage.attachments);
    reused = attachmentCopies(draftMessage.attachments.filter((file) => keep.has(String(file._id))));
    dropped = draftMessage.attachments.filter((file) => !keep.has(String(file._id)));
  }
  if (!body && !incoming.length && !reused.length) {
    throw httpError(400, "Message or an attachment is required");
  }

  const addresses = await resolveAddresses(emails);
  const stored = await storeInboxFiles(user.employeeId, incoming);
  let message;
  try {
    message = await MailMessage.create({
      fromEmployeeId: user.employeeId,
      fromName: user.name,
      fromEmail: user.email,
      to: addresses,
      subject,
      body,
      preview: previewOf(body) || [...reused, ...stored].map((file) => file.name).join(", "),
      companyName: user.companyName || "",
      attachments: [...reused, ...stored],
    });
  } catch (err) {
    await removeChatFiles(stored);
    throw err;
  }

  await Mailbox.create({
    ownerId: user.employeeId,
    messageId: message._id,
    folder: "sent",
    unread: false,
    starred: false,
  });

  const internalOwners = new Set();
  for (const person of addresses) {
    if (person.kind !== "internal" || !person.employeeId || person.employeeId === user.employeeId) continue;
    if (internalOwners.has(person.employeeId)) continue;
    internalOwners.add(person.employeeId);
    await Mailbox.create({
      ownerId: person.employeeId,
      messageId: message._id,
      folder: "inbox",
      unread: true,
      starred: false,
    });
  }

  const { error: externalError, smtp } = await deliverExternal(message, user);
  if (!smtp) copyToMailboxes(message, user.employeeId, [...internalOwners]);
  if (draftBox && draftMessage) {
    await Mailbox.deleteOne({ _id: draftBox._id, ownerId: user.employeeId });
    await MailMessage.deleteOne({ _id: draftMessage._id });
    await removeChatFiles(dropped);
  }
  const fresh = await MailMessage.findById(message._id);
  const boxes = await Mailbox.find({ messageId: message._id });
  for (const box of boxes) pushMail(req, box.ownerId, toMailDto(box, fresh));
  const mine = boxes.find((box) => box.ownerId === user.employeeId);
  return { mail: toMailDto(mine, fresh), externalError };
}

async function replyMail(user, mailboxId, bodyText, req) {
  const body = String(bodyText || "").trim();
  if (!body) throw httpError(400, "Message is required");
  if (live.isLiveId(mailboxId)) {
    const { row } = await live.liveRow(user.employeeId, mailboxId);
    const mail = row.dto;
    const target = mail.folder === "sent" ? mail.toEmail.split(",")[0].trim() : mail.fromEmail;
    if (!target) throw httpError(400, "This mail has no address to reply to");
    const subject = mail.subject.toLowerCase().startsWith("re:") ? mail.subject : `Re: ${mail.subject}`;
    return sendMail(user, { to: target, subject, body }, req);
  }
  const { message } = await loadOwned(user, mailboxId);
  const iSentIt = message.fromEmployeeId === user.employeeId;
  const target = iSentIt ? message.to[0] : { email: message.fromEmail, name: message.fromName };
  if (!target?.email) throw httpError(400, "This mail has no address to reply to");
  const subject = message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`;
  return sendMail(user, { to: target.email, subject, body }, req);
}

async function saveDraft(user, input, req) {
  const emails = String(input.to || "").trim() ? parseAddresses(input.to) : [];
  const addresses = emails.length ? await resolveAddresses(emails) : [];
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "");
  const incoming = Array.isArray(input.files) ? input.files : [];
  if (!emails.length && !subject && !body.trim() && !incoming.length && !input.draftId) {
    throw httpError(400, "Nothing to save");
  }
  const stored = await storeInboxFiles(user.employeeId, incoming);
  let committed = false;
  try {
    if (input.draftId) {
      const { box, message } = await loadOwned(user, String(input.draftId));
      if (box.folder !== "drafts") throw httpError(400, "This mail is not a draft");
      const keep = keptAttachmentIds(input.keepAttachmentIds, message.attachments);
      const dropped = message.attachments.filter((file) => !keep.has(String(file._id)));
      const kept = attachmentCopies(message.attachments.filter((file) => keep.has(String(file._id))));
      message.to = addresses;
      message.subject = subject;
      message.body = body;
      message.preview = previewOf(body) || [...kept, ...stored].map((file) => file.name).join(", ") || "(draft)";
      message.attachments = [...kept, ...stored];
      await message.save();
      committed = true;
      await removeChatFiles(dropped);
      const dto = toMailDto(box, message);
      pushMail(req, user.employeeId, dto);
      return dto;
    }

    const message = await MailMessage.create({
      fromEmployeeId: user.employeeId,
      fromName: user.name,
      fromEmail: user.email,
      to: addresses,
      subject,
      body,
      preview: previewOf(body) || stored.map((file) => file.name).join(", ") || "(draft)",
      companyName: user.companyName || "",
      attachments: stored,
    });
    const box = await Mailbox.create({
      ownerId: user.employeeId,
      messageId: message._id,
      folder: "drafts",
      unread: false,
    });
    const dto = toMailDto(box, message);
    pushMail(req, user.employeeId, dto);
    committed = true;
    return dto;
  } catch (err) {
    if (!committed) await removeChatFiles(stored);
    throw err;
  }
}

async function openMail(user, mailboxId) {
  if (live.isLiveId(mailboxId)) return live.openLive(user.employeeId, mailboxId);
  const { box, message } = await loadOwned(user, mailboxId);
  if (box.unread) {
    box.unread = false;
    await box.save();
  }
  return toMailDto(box, message);
}

async function toggleStar(user, mailboxId) {
  if (live.isLiveId(mailboxId)) return live.starLive(user.employeeId, mailboxId);
  const { box, message } = await loadOwned(user, mailboxId);
  box.starred = !box.starred;
  await box.save();
  return toMailDto(box, message);
}

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(400, `${label} time is not valid`);
  return date;
}

function futureDate(value, label) {
  const date = validDate(value, label);
  if (date.getTime() <= Date.now()) throw httpError(400, `${label} time must be in the future`);
  return date;
}

async function snoozeMail(user, mailboxId, until, req) {
  hrmsOnly(mailboxId, "Snooze");
  const { box, message } = await loadOwned(user, mailboxId);
  box.snoozedUntil = until ? futureDate(until, "Snooze") : null;
  await box.save();
  const dto = toMailDto(box, message);
  pushMail(req, user.employeeId, dto);
  return dto;
}

async function remindMail(user, mailboxId, at, req) {
  hrmsOnly(mailboxId, "Reminder");
  const { box, message } = await loadOwned(user, mailboxId);
  box.reminderAt = at ? futureDate(at, "Reminder") : null;
  await box.save();
  const dto = toMailDto(box, message);
  pushMail(req, user.employeeId, dto);
  return dto;
}

async function setMailTask(user, mailboxId, input, req) {
  hrmsOnly(mailboxId, "Add task");
  const { box, message } = await loadOwned(user, mailboxId);
  const title = String(input?.title || "").trim();
  if (!title) {
    box.task = { title: "", dueAt: null, done: false };
  } else {
    box.task = {
      title,
      dueAt: input?.dueAt ? validDate(input.dueAt, "Task") : null,
      done: input?.done === true,
    };
  }
  await box.save();
  const dto = toMailDto(box, message);
  pushMail(req, user.employeeId, dto);
  return dto;
}

async function trashMails(user, ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)))];
  if (!unique.length) throw httpError(400, "Choose a mail");
  await live.trashLive(user.employeeId, unique);
  const hrms = unique.filter((id) => !live.isLiveId(id));
  if (hrms.length) {
    await Mailbox.updateMany(
      { _id: { $in: hrms }, ownerId: user.employeeId, folder: { $ne: "trash" } },
      { $set: { folder: "trash", unread: false } },
    );
  }
  return { ok: true };
}

async function loadAttachment(user, attachmentId) {
  if (!attachmentId) throw httpError(404, "File not found");
  if (live.isLiveFileId(attachmentId)) return live.liveAttachment(user.employeeId, attachmentId);
  const message = await MailMessage.findOne({ "attachments._id": attachmentId });
  if (!message) throw httpError(404, "File not found");
  const box = await Mailbox.findOne({ ownerId: user.employeeId, messageId: message._id });
  if (!box) throw httpError(404, "File not found");
  const file = message.attachments.id(attachmentId);
  if (!file) throw httpError(404, "File not found");
  const bytes = await readChatFile(file.storageKey);
  return { file, bytes };
}

async function receiveInbound(payload, req) {
  const secret = process.env.MAIL_INBOUND_SECRET || "";
  const given = String(req.get("x-mail-secret") || "");
  if (!secret) throw httpError(503, "Inbound mail is not configured");
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, "Invalid inbound secret");
  }

  const recipients = parseAddresses(payload.to);
  const senderEmail = parseAddresses(payload.from)[0];
  if (!senderEmail) throw httpError(400, "From is required");
  if (!recipients.length) throw httpError(400, "To is required");

  const internal = [];
  for (const email of recipients) {
    const person = await findByEmail(email);
    if (person?.employeeId) internal.push(person);
  }
  if (!internal.length) throw httpError(404, "No HRMS inbox matches this address");

  const message = await MailMessage.create({
    fromEmployeeId: "",
    fromName: String(payload.fromName || "").trim() || senderEmail,
    fromEmail: senderEmail,
    to: internal.map((person) => ({
      employeeId: person.employeeId,
      name: person.name,
      email: person.email,
      kind: "internal",
    })),
    subject: String(payload.subject || "").trim() || "(no subject)",
    body: String(payload.text || ""),
    preview: previewOf(payload.text) || "(no subject)",
    externalStatus: "none",
  });

  for (const person of internal) {
    const box = await Mailbox.create({
      ownerId: person.employeeId,
      messageId: message._id,
      folder: "inbox",
      unread: true,
    });
    pushMail(req, person.employeeId, toMailDto(box, message));
  }
  return { id: String(message._id), delivered: internal.length };
}

async function searchPeople(q) {
  const term = String(q || "").trim();
  if (term.length < 2) return [];
  const rows = await User.find({
    $or: [
      { name: new RegExp(escapeRegex(term), "i") },
      { "official.officialEmail": new RegExp(escapeRegex(term), "i") },
    ],
  })
    .select("name official.officialEmail")
    .limit(20)
    .lean();
  return rows
    .filter((row) => row.official?.officialEmail)
    .map((row) => ({
      employeeId: String(row._id),
      name: row.name || "",
      email: String(row.official.officialEmail).toLowerCase(),
    }));
}

async function mailAccount(user) {
  const actor = mailActor(user);
  const row = await User.findById(actor.employeeId).select("official.emailAppPasswordSet").lean();
  return { ...actor, appPasswordSet: row?.official?.emailAppPasswordSet === true };
}

async function saveAppPassword(user, value) {
  const { sealAppPassword } = require("../utils/userMailbox");
  const actor = mailActor(user);
  const sealed = sealAppPassword(value);
  await User.updateOne(
    { _id: actor.employeeId },
    {
      $set: {
        "official.emailAppPassword": sealed.emailAppPassword,
        "official.emailAppPasswordSet": sealed.emailAppPasswordSet,
      },
    },
  );
  live.forget(actor.employeeId);
  if (!sealed.emailAppPasswordSet) return { ok: true, appPasswordSet: false, importing: false };
  try {
    await checkMailboxLogin(actor.employeeId);
  } catch (err) {
    const detail = String(err.responseText || err.response || err.message || "").trim();
    console.error("Mailbox login failed:", detail);
    let importError = detail || "Could not reach the mailbox";
    if (/web ?browser|WEBALERT|ALERT/i.test(detail)) {
      importError = `Google blocked this sign-in from the server. Open Gmail, approve the "Was this you?" security alert, then save again. (${detail})`;
    } else if (err.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials/i.test(detail)) {
      importError = `Gmail rejected this app password for ${actor.email}. Create the app password while signed in to that exact Google account. (${detail})`;
    }
    return { ok: true, appPasswordSet: true, importing: false, importError };
  }
  return { ok: true, appPasswordSet: true, importing: false };
}

module.exports = {
  mailActor,
  mailAccount,
  saveAppPassword,
  listMessages,
  folderCounts,
  sendMail,
  replyMail,
  saveDraft,
  openMail,
  toggleStar,
  snoozeMail,
  remindMail,
  setMailTask,
  trashMails,
  loadAttachment,
  receiveInbound,
  searchPeople,
};
