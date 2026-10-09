/**
 * CHAT FILES — multer (memory) → private Cloudinary raw files under hrms/chat/<companyId>
 * Up to 5 files of 10 MB per message. Files are "authenticated" on Cloudinary, so they
 * only download through GET /api/chat/attachments/:id after the chat access check.
 */
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { cloudinary, folderFor } = require("../middleware/upload");
const { chatError } = require("./chatAccess");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
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

/** Multer: field "files" (up to MAX_FILES), memory only until the access check passes */
const uploadChatFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
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
      ? "Each file must be 10 MB or smaller"
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

const uploadOne = (file, folder) =>
  new Promise((resolve, reject) => {
    const ext = extensionOf(file.originalname);
    const stream = cloudinary.uploader.upload_stream(
      {
        ...CLOUDINARY_FILE,
        folder,
        public_id: `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`,
        use_filename: false,
        unique_filename: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          name: cleanName(file.originalname),
          size: file.size,
          mimeType: ALLOWED[ext],
          storageKey: result.public_id,
        });
      }
    );
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
const storeChatFiles = async (companyId, files) => {
  assertCloudinary();
  const folder = `${folderFor("chat")}/${String(companyId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const results = await Promise.allSettled(files.map((file) => uploadOne(file, folder)));
  const stored = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) {
    await removeChatFiles(stored);
    throw chatError(502, failed.reason?.message || "File upload failed");
  }
  return stored;
};

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
  removeChatFiles,
  readChatFile,
};
