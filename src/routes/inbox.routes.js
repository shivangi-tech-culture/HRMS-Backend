/**
 * Inbox routes → /api/mail
 * Organization POST /send stays on mail.routes.js.
 */
const express = require("express");
const { protect } = require("../middleware/auth");
const { uploadChatFiles, chatUploadError } = require("../utils/chatFiles");
const inbox = require("../services/inboxMail");

const router = express.Router();

function withFiles(req, res, next) {
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("multipart/form-data")) return next();
  return uploadChatFiles(req, res, next);
}

function actor(req) {
  return inbox.mailActor(req.user);
}

router.post("/inbound", async (req, res, next) => {
  try {
    res.status(201).json(await inbox.receiveInbound(req.body || {}, req));
  } catch (err) {
    next(err);
  }
});

router.use(protect);

router.get("/me", (req, res, next) => {
  try {
    res.json(actor(req));
  } catch (err) {
    next(err);
  }
});

router.get("/people", async (req, res, next) => {
  try {
    res.json({ people: await inbox.searchPeople(req.query.q || req.query.search || "") });
  } catch (err) {
    next(err);
  }
});

router.get("/messages/counts", async (req, res, next) => {
  try {
    res.json(await inbox.folderCounts(actor(req)));
  } catch (err) {
    next(err);
  }
});

router.get("/messages", async (req, res, next) => {
  try {
    const messages = await inbox.listMessages(actor(req), {
      folder: req.query.folder || "inbox",
      q: req.query.q || req.query.search || "",
    });
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

router.get("/messages/:id", async (req, res, next) => {
  try {
    res.json(await inbox.openMail(actor(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/messages", withFiles, async (req, res, next) => {
  try {
    const result = await inbox.sendMail(actor(req), { ...(req.body || {}), files: req.files }, req);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/messages/drafts", withFiles, async (req, res, next) => {
  try {
    res.status(201).json(await inbox.saveDraft(actor(req), { ...(req.body || {}), files: req.files }, req));
  } catch (err) {
    next(err);
  }
});

router.post("/messages/trash", async (req, res, next) => {
  try {
    res.json(await inbox.trashMails(actor(req), req.body?.ids));
  } catch (err) {
    next(err);
  }
});

router.post("/messages/:id/reply", async (req, res, next) => {
  try {
    const result = await inbox.replyMail(actor(req), req.params.id, req.body?.body, req);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/messages/:id/star", async (req, res, next) => {
  try {
    res.json(await inbox.toggleStar(actor(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/messages/:id/snooze", async (req, res, next) => {
  try {
    res.json(await inbox.snoozeMail(actor(req), req.params.id, req.body?.until, req));
  } catch (err) {
    next(err);
  }
});

router.post("/messages/:id/reminder", async (req, res, next) => {
  try {
    res.json(await inbox.remindMail(actor(req), req.params.id, req.body?.at, req));
  } catch (err) {
    next(err);
  }
});

router.post("/messages/:id/task", async (req, res, next) => {
  try {
    res.json(await inbox.setMailTask(actor(req), req.params.id, req.body || {}, req));
  } catch (err) {
    next(err);
  }
});

router.get("/attachments/:id", async (req, res, next) => {
  try {
    const { file, bytes } = await inbox.loadAttachment(actor(req), req.params.id);
    const inline = String(file.mimeType || "").startsWith("image/") || file.mimeType === "application/pdf";
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${String(file.name || "file").replace(/"/g, "")}"`,
    );
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

router.use((err, _req, res, _next) => {
  const error = chatUploadError(err);
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ message: error.message || "Mail request failed" });
});

module.exports = router;
