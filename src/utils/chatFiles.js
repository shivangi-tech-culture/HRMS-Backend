/**
 * CHAT FILES — multer (temp disk) → private Cloudinary raw files under hrms/chat/<companyId>
 * Up to 5 files per message. Images, PDF and other docs are 10 MB. Zip is 250 MB.
 * Files are "authenticated" on Cloudinary, so they only download through
 * GET /api/chat/attachments/:id after the chat access check.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { cloudinary, folderFor } = require("../middleware/upload");
const { chatError } = require("./chatAccess");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 5;

/**
 * The stored type comes from this list, never from the browser, and nothing
 * that a browser would run as a page (html, svg) is allowed.
 */
const ALLOWED = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

const CLOUDINARY_FILE = { resource_type: "raw", type: "authenticated" };

const extensionOf = (name) => path.extname(String(name || "")).toLowerCase();

/** Multer: field "files" (up to MAX_FILES). Disk until Cloudinary accepts the file. */
const uploadChatFiles = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = extensionOf(file.originalname);
      cb(null, `hrms-chat-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: MAX_ZIP_BYTES, files: MAX_FILES },
  fileFilter(_req, file, cb) {
    if (ALLOWED[extensionOf(file.originalname)]) return cb(null, true);
    return cb(chatError(400, `File type not allowed: ${file.originalname}`));
  },
}).array("files", MAX_FILES);

/** Multer limit errors → readable 400s; anything else passes through */
const chatUploadError = (err) => {
  if (!(err instanceof multer.MulterError)) return err;
  const message =
    err.code === "LIMIT_FILE_SIZE"
      ? "Zip files must be 250 MB or smaller. Other files must be 10 MB or smaller"
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
        ? `You can attach up to ${MAX_FILES} files`
        : err.message;
  return chatError(400, message);
};

/** Browsers send multipart names as latin1; keep a safe display name */
const cleanName = (name) => {
  const base = path.basename(Buffer.from(String(name || ""), "latin1").toString("utf8"));
  return base.replace(/[\u0000-\u001f"\\/]/g, "_").slice(0, 255) || "file";
};

const assertCloudinary = () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    throw chatError(500, "File upload is not configured (Cloudinary env missing)");
  }
};

const byteLimit = (type, file) =>
  type === "chat" && extensionOf(file.originalname) === ".zip" ? MAX_ZIP_BYTES : MAX_FILE_BYTES;

const dropTemp = (file) => {
  if (!file?.path) return Promise.resolve();
  return fs.promises.unlink(file.path).catch(() => {});
};

const uploadOne = (file, folder) =>
  new Promise((resolve, reject) => {
    const ext = extensionOf(file.originalname);
    const options = {
      ...CLOUDINARY_FILE,
      folder,
      public_id: `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`,
      use_filename: false,
      unique_filename: false,
      timeout: 600000,
    };
    const finish = (err, result) => {
      if (err || !result?.public_id) return reject(err || new Error("File upload failed"));
      resolve({
        name: cleanName(file.originalname),
        size: file.size,
        mimeType: ALLOWED[ext],
        storageKey: result.public_id,
      });
    };
    if (ext === ".zip" && file.path) {
      cloudinary.uploader.upload_large(
        file.path,
        { ...options, chunk_size: 20000000 },
        finish
      );
      return;
    }
    const stream = cloudinary.uploader.upload_stream(options, finish);
    if (file.path) {
      fs.createReadStream(file.path).on("error", reject).pipe(stream);
      return;
    }
    stream.end(file.buffer);
  });

/** Delete stored files (best effort — a failed delete never fails the request) */
const removeChatFiles = async (attachments) => {
  await Promise.all(
    (attachments || []).map((a) =>
      cloudinary.uploader.destroy(a.storageKey, CLOUDINARY_FILE).catch(() => {})
    )
  );
};

/** Upload message files; returns attachment rows for ChatMessage */
const storeChatFiles = async (companyId, files) => storeTypedFiles("chat", companyId, files);

/** Inbox attachments, same Cloudinary rules, folder hrms/mail */
const storeInboxFiles = async (ownerId, files) => storeTypedFiles("mail", ownerId, files);

const storeTypedFiles = async (type, ownerId, files) => {
  const list = Array.isArray(files) ? files : [];
  try {
    if (!list.length) return [];
    for (const file of list) {
      if (file.size <= byteLimit(type, file)) continue;
      const zip = extensionOf(file.originalname) === ".zip";
      throw chatError(
        400,
        zip && type === "chat"
          ? "Zip files must be 250 MB or smaller"
          : "Each file must be 10 MB or smaller"
      );
    }
    assertCloudinary();
    const folder = `${folderFor(type)}/${String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const results = await Promise.allSettled(list.map((file) => uploadOne(file, folder)));
    const stored = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      await removeChatFiles(stored);
      throw chatError(502, failed.reason?.message || "File upload failed");
    }
    return stored;
  } finally {
    await Promise.all(list.map(dropTemp));
  }
};

/** Short-lived Cloudinary URL. Used for zip so the API does not buffer 250 MB. */
const signedChatFileUrl = (storageKey) =>
  cloudinary.url(storageKey, {
    ...CLOUDINARY_FILE,
    sign_url: true,
    secure: true,
    flags: "attachment",
    expires_at: Math.round(Date.now() / 1000) + 30 * 60,
  });

/** File bytes from Cloudinary (signed URL — files are not public) */
const readChatFile = async (storageKey) => {
  const url = cloudinary.url(storageKey, { ...CLOUDINARY_FILE, sign_url: true, secure: true });
  const response = await fetch(url);
  if (!response.ok) throw chatError(404, "File not found");
  return Buffer.from(await response.arrayBuffer());
};

module.exports = {
  uploadChatFiles,
  chatUploadError,
  storeChatFiles,
  storeInboxFiles,
  removeChatFiles,
  readChatFile,
  signedChatFileUrl,
};
