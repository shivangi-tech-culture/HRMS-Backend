/**
 * Reads the logged-in user's real mailbox over IMAP.
 * Nothing from the mailbox is written to MongoDB. The list only downloads headers,
 * the start of each mail and its attachment list; the full mail is fetched when it is
 * opened. An in-memory cache is served right away and refreshed in the background.
 */
const { loadMailboxCreds, openImap } = require("./userMailbox");

const FRESH_MS = 60_000;
const KEEP_MS = 30 * 60_000;
const PER_FOLDER = 30;
const PREVIEW_BYTES = 16 * 1024;
const IDLE_MS = 5 * 60_000;
const cache = new Map();
const loading = new Map();
const pool = new Map();

const ID_RE = /^g-(inbox|sent|trash)-(\d+)$/;
const FILE_RE = /^g-(inbox|sent|trash)-(\d+)-(\d+(?:\.\d+)*)$/;

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

/** Attachments from the IMAP body structure, so the list does not need to download them. */
function filesOf(node, id, out = []) {
  if (!node) return out;
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    for (const child of node.childNodes) filesOf(child, id, out);
    return out;
  }
  const name = node.dispositionParameters?.filename || node.parameters?.name || "";
  const isFile = node.disposition === "attachment" || (name && !/^text\//i.test(node.type || ""));
  if (isFile && node.part) {
    out.push({
      id: `${id}-${node.part}`,
      name: name || `attachment-${out.length + 1}`,
      size: Number(node.size) || 0,
      mimeType: node.type || "application/octet-stream",
    });
  }
  return out;
}

function toDto(key, uid, flags, parsed, structure) {
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
    attachments: filesOf(structure, id),
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
    const query = { uid: true, flags: true, bodyStructure: true, source: { maxLength: PREVIEW_BYTES } };
    for await (const msg of client.fetch(`${start}:*`, query)) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source).catch(() => null);
      if (!parsed) continue;
      const full = msg.source.length < PREVIEW_BYTES;
      rows.push({ dto: toDto(key, msg.uid, msg.flags || new Set(), parsed, msg.bodyStructure), full });
    }
  } finally {
    lock.release();
  }
  return rows;
}

function closeSlot(key, slot) {
  clearTimeout(slot.timer);
  if (pool.get(key) === slot) pool.delete(key);
  slot.ready.then((client) => client.logout()).catch(() => {});
}

function touch(key, slot) {
  clearTimeout(slot.timer);
  slot.timer = setTimeout(() => closeSlot(key, slot), IDLE_MS);
  slot.timer.unref?.();
}

/** One open IMAP connection per mailbox, closed after a few idle minutes; logging in takes seconds. */
async function connection(creds) {
  const key = `${creds.userId}:${creds.email}`;
  const slot = pool.get(key);
  if (slot) {
    const client = await slot.ready.catch(() => null);
    if (client?.usable) {
      touch(key, slot);
      return client;
    }
    closeSlot(key, slot);
  }
  const fresh = { ready: openImap(creds), timer: null };
  pool.set(key, fresh);
  try {
    const client = await fresh.ready;
    client.on("error", (err) => console.error("Mailbox connection error:", err.message));
    client.on("close", () => {
      if (pool.get(key) === fresh) pool.delete(key);
    });
    touch(key, fresh);
    return client;
  } catch (err) {
    if (pool.get(key) === fresh) pool.delete(key);
    throw err;
  }
}

async function withMailbox(creds, fn) {
  const client = await connection(creds);
  try {
    return await fn(client);
  } catch (err) {
    if (client.usable) throw err;
    return fn(await connection(creds));
  }
}

function refresh(key, creds) {
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

/** Fresh cache is returned as is; older cache is returned right away and refreshed behind it. */
async function loadMailbox(userId) {
  const creds = await loadMailboxCreds(userId);
  if (!creds) return null;
  const key = `${creds.userId}:${creds.email}`;
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (age < FRESH_MS) return hit;
  if (age < KEEP_MS) {
    refresh(key, creds).catch((err) => console.error("Mailbox refresh failed:", err.responseText || err.message));
    return hit;
  }
  return refresh(key, creds);
}

/** Starts reading the mailbox (e.g. at login) so the Mail page opens instantly. */
function warm(userId) {
  loadMailbox(userId).catch((err) => console.error("Mailbox warm-up failed:", err.responseText || err.message));
}

function forget(userId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
  for (const [key, slot] of pool.entries()) {
    if (key.startsWith(`${userId}:`)) closeSlot(key, slot);
  }
}

/** Keeps the cache on screen but reads the mailbox again on the next request. */
function markStale(userId) {
  for (const [key, entry] of cache.entries()) {
    if (key.startsWith(`${userId}:`)) entry.at = 0;
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

async function inFolder(entry, folder, fn) {
  return withMailbox(entry.creds, async (client) => {
    const lock = await client.getMailboxLock(entry.paths[folder]);
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  });
}

async function setFlag(entry, folder, uid, flag, on) {
  await inFolder(entry, folder, async (client) => {
    if (on) await client.messageFlagsAdd(String(uid), [flag], { uid: true });
    else await client.messageFlagsRemove(String(uid), [flag], { uid: true });
  });
}

/** Downloads the whole mail once it is opened, and marks it read. */
async function openLive(userId, id) {
  const { simpleParser } = require("mailparser");
  const { entry, row } = await liveRow(userId, id);
  const [, folder, uid] = ID_RE.exec(id);
  if (row.full && !row.dto.unread) return row.dto;
  await inFolder(entry, folder, async (client) => {
    if (!row.full) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (msg?.source) {
        const parsed = await simpleParser(msg.source);
        row.dto.body = bodyText(parsed);
        row.full = true;
      }
    }
    if (row.dto.unread) {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      row.dto.unread = false;
    }
  });
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
  for (const id of live) {
    const row = entry.rows.get(id);
    if (row) row.dto.folder = "trash";
  }
  markStale(userId);
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
  markStale(userId);
  return true;
}

async function liveAttachment(userId, fileId) {
  const [, folder, uid, part] = FILE_RE.exec(fileId);
  const { entry, row } = await liveRow(userId, `g-${folder}-${uid}`);
  const file = row.dto.attachments.find((item) => item.id === fileId);
  if (!file) throw liveError(404, "File not found");
  const bytes = await inFolder(entry, folder, async (client) => {
    const { content } = await client.download(uid, part, { uid: true });
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    return Buffer.concat(chunks);
  });
  return { file: { name: file.name, mimeType: file.mimeType }, bytes };
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
  warm,
  forget,
};
