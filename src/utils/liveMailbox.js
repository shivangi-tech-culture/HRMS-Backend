/**
 * Reads the logged-in user's real mailbox over IMAP on every request.
 * Nothing from the mailbox is written to MongoDB; a short in-memory cache
 * keeps the Mail page fast between clicks.
 */
const { loadMailboxCreds, openImap } = require("./userMailbox");

const CACHE_MS = 60_000;
const PER_FOLDER = 30;
const cache = new Map();
const loading = new Map();

const ID_RE = /^g-(inbox|sent|trash)-(\d+)$/;
const FILE_RE = /^g-(inbox|sent|trash)-(\d+)-(\d+)$/;

function liveError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isLiveId(id) {
  return ID_RE.test(String(id || ""));
}

function isLiveFileId(id) {
  return FILE_RE.test(String(id || ""));
}

function initials(name, email) {
  const source = String(name || email || "").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function bodyText(parsed) {
  const text = String(parsed?.text || "").trim();
  if (text) return text.slice(0, 20000);
  return String(parsed?.html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

function addresses(list) {
  return (list?.value || [])
    .map((item) => ({ name: item.name || item.address || "", email: String(item.address || "").toLowerCase() }))
    .filter((item) => item.email);
}

function hrmsIdOf(parsed) {
  return /^<?hrms-([a-f0-9]{24})@/i.exec(String(parsed.messageId || ""))?.[1] || "";
}

function toDto(key, uid, flags, parsed) {
  const from = addresses(parsed.from)[0] || { name: "", email: "" };
  const to = addresses(parsed.to);
  const body = bodyText(parsed);
  const id = `g-${key}-${uid}`;
  return {
    id,
    messageId: id,
    hrmsMessageId: hrmsIdOf(parsed),
    source: "gmail",
    folder: key,
    fromName: from.name || from.email,
    fromEmail: from.email,
    toName: to.map((item) => item.name || item.email).join(", "),
    toEmail: to.map((item) => item.email).join(", "),
    subject: String(parsed.subject || "").trim() || "(no subject)",
    preview: body.replace(/\s+/g, " ").slice(0, 140),
    body,
    createdAt: (parsed.date || new Date()).toISOString(),
    unread: key === "inbox" && !flags.has("\\Seen"),
    starred: flags.has("\\Flagged"),
    avatarInitials: initials(from.name, from.email),
    avatarUrl: "",
    company: "",
    attachments: (parsed.attachments || []).map((file, index) => ({
      id: `${id}-${index}`,
      name: file.filename || `attachment-${index + 1}`,
      size: file.size || 0,
      mimeType: file.contentType || "application/octet-stream",
    })),
    externalStatus: "none",
    externalError: "",
    snoozedUntil: null,
    reminderAt: null,
    task: null,
  };
}

async function folderPaths(client) {
  const boxes = await client.list();
  const find = (flag, pattern) =>
    boxes.find((box) => String(box.specialUse || "") === flag)?.path ||
    boxes.find((box) => pattern.test(box.path))?.path ||
    "";
  return {
    inbox: "INBOX",
    sent: find("\\Sent", /sent/i),
    trash: find("\\Trash", /trash|bin/i),
  };
}

async function readFolder(client, path, key) {
  const { simpleParser } = require("mailparser");
  const rows = [];
  if (!path) return rows;
  const lock = await client.getMailboxLock(path);
  try {
    const total = Number(client.mailbox?.exists) || 0;
    if (!total) return rows;
    const start = Math.max(1, total - PER_FOLDER + 1);
    for await (const msg of client.fetch(`${start}:*`, { source: true, uid: true, flags: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      rows.push({ dto: toDto(key, msg.uid, msg.flags || new Set(), parsed), parsed });
    }
  } finally {
    lock.release();
  }
  return rows;
}

async function withMailbox(creds, fn) {
  const client = await openImap(creds);
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function loadMailbox(userId) {
  const creds = await loadMailboxCreds(userId);
  if (!creds) return null;
  const key = `${creds.userId}:${creds.email}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  if (loading.has(key)) return loading.get(key);

  const job = withMailbox(creds, async (client) => {
    const paths = await folderPaths(client);
    const entry = { at: Date.now(), creds, paths, rows: new Map() };
    for (const folder of ["inbox", "sent", "trash"]) {
      for (const row of await readFolder(client, paths[folder], folder)) entry.rows.set(row.dto.id, row);
    }
    cache.set(key, entry);
    return entry;
  }).finally(() => loading.delete(key));
  loading.set(key, job);
  return job;
}

function forget(userId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

/** Mail from the user's real mailbox for the given HRMS folder, newest first. */
async function liveMessages(userId, folder) {
  let entry;
  try {
    entry = await loadMailbox(userId);
  } catch (err) {
    console.error("Mailbox read failed:", err.responseText || err.message);
    return [];
  }
  if (!entry) return [];
  const rows = [...entry.rows.values()].map((row) => row.dto);
  const pick = {
    inbox: (mail) => mail.folder === "inbox",
    sent: (mail) => mail.folder === "sent",
    trash: (mail) => mail.folder === "trash",
    unread: (mail) => mail.folder === "inbox" && mail.unread,
    starred: (mail) => mail.folder !== "trash" && mail.starred,
    all: (mail) => mail.folder !== "trash",
  }[folder];
  return pick ? rows.filter(pick) : [];
}

async function liveRow(userId, id) {
  const entry = await loadMailbox(userId);
  const row = entry?.rows.get(id);
  if (!row) throw liveError(404, "Mail not found");
  return { entry, row };
}

async function setFlag(entry, folder, uid, flag, on) {
  await withMailbox(entry.creds, async (client) => {
    const lock = await client.getMailboxLock(entry.paths[folder]);
    try {
      if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
    } finally {
      lock.release();
    }
  });
}

async function openLive(userId, id) {
  const { entry, row } = await liveRow(userId, id);
  const [, folder, uid] = ID_RE.exec(id);
  if (row.dto.unread) {
    await setFlag(entry, folder, uid, "\\Seen", true);
    row.dto.unread = false;
  }
  return row.dto;
}

async function starLive(userId, id) {
  const { entry, row } = await liveRow(userId, id);
  const [, folder, uid] = ID_RE.exec(id);
  await setFlag(entry, folder, uid, "\\Flagged", !row.dto.starred);
  row.dto.starred = !row.dto.starred;
  return row.dto;
}

async function trashLive(userId, ids) {
  const live = ids.filter(isLiveId);
  if (!live.length) return;
  const entry = await loadMailbox(userId);
  if (!entry?.paths.trash) throw liveError(400, "This mailbox has no Trash folder");
  await withMailbox(entry.creds, async (client) => {
    for (const folder of ["inbox", "sent"]) {
      const uids = live
        .map((id) => ID_RE.exec(id))
        .filter((match) => match && match[1] === folder)
        .map((match) => match[2]);
      if (!uids.length) continue;
      const lock = await client.getMailboxLock(entry.paths[folder]);
      try {
        await client.messageMove(uids.join(","), entry.paths.trash, { uid: true });
      } finally {
        lock.release();
      }
    }
  });
  forget(userId);
}

/** Puts a raw mail into the user's real Inbox or Sent folder, so it also shows in their mail app. */
async function appendLive(userId, folder, raw, { seen = false, date } = {}) {
  const creds = await loadMailboxCreds(userId);
  if (!creds) return false;
  await withMailbox(creds, async (client) => {
    const path = folder === "inbox" ? "INBOX" : (await folderPaths(client))[folder];
    if (!path) throw liveError(400, `This mailbox has no ${folder} folder`);
    await client.append(path, raw, seen ? ["\\Seen"] : [], date);
  });
  forget(userId);
  return true;
}

async function liveAttachment(userId, fileId) {
  const [, folder, uid, index] = FILE_RE.exec(fileId);
  const { row } = await liveRow(userId, `g-${folder}-${uid}`);
  const file = row.parsed.attachments?.[Number(index)];
  if (!file) throw liveError(404, "File not found");
  return {
    file: { name: file.filename || "file", mimeType: file.contentType || "application/octet-stream" },
    bytes: file.content,
  };
}

module.exports = {
  isLiveId,
  isLiveFileId,
  liveMessages,
  liveRow,
  openLive,
  starLive,
  trashLive,
  appendLive,
  liveAttachment,
  forget,
};
