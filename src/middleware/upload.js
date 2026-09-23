/**
 * File upload — Cloudinary only (no database save)
 *
 * Flow: multer (memory) → upload stream to Cloudinary → return secure URL
 * type=education → folder hrms/education
 * type=account   → folder hrms/account
 *
 * IMPORTANT — PDF not opening in browser?
 *   Cloudinary FREE plans block PDF delivery by default.
 *   Fix (one-time in Cloudinary Console):
 *     Settings → Security → check "Allow delivery of PDF and ZIP files" → Save
 *   Then re-upload (or wait for CDN cache). Old blocked URLs may stay broken briefly.
 *
 * A real PDF is stored as an image so the browser can open it.
 * Word and Excel are stored as raw files.
 * The file bytes are checked. A .pdf that is not actually a PDF is rejected.
 *
 * Env:
 *   CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET
 *   CLOUDINARY_FOLDER=hrms   (files go to hrms/education or hrms/account)
 */
const multer = require("multer");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

/** Allowed attachment kinds. Folder on Cloudinary is hrms/<type>. */
const UPLOAD_TYPES = ["education", "account"];

/** Common file parser for every type. Field name: "document" — max 5 MB */
const uploadFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, image, Word, or Excel files are allowed"), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("document");

/** Base name only — never put .pdf here for image-type uploads */
const safeBaseName = (originalName) =>
  path
    .parse(originalName || "file")
    .name.replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "file";

/**
 * What the bytes actually are. Extension alone is not trusted.
 * Returns pdf | jpg | png | gif | webp | doc | docx | xls | xlsx, or null.
 */
const detectKind = (file) => {
  const buf = file.buffer || Buffer.alloc(0);
  const name = String(file.originalname || "").toLowerCase();
  if (buf.slice(0, 4).toString() === "%PDF") return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.slice(0, 4).toString("hex") === "89504e47") return "png";
  if (buf.slice(0, 3).toString() === "GIF") return "gif";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
    return "webp";
  }
  // Old Word / Excel (OLE)
  if (buf.slice(0, 4).toString("hex") === "d0cf11e0") {
    return name.endsWith(".xls") ? "xls" : "doc";
  }
  // New Word / Excel are zip files
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
    return "docx";
  }
  return null;
};

const rejectFile = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/**
 * Upload options per real file type.
 * PDF → image, so the browser can open it.
 * Word / Excel → raw download.
 * JPG / PNG / GIF / WEBP → image.
 */
/** hrms/education stays hrms/education; account uses the same root. */
const folderFor = (type) => {
  const configured = (process.env.CLOUDINARY_FOLDER || "hrms").replace(/\/+$/, "");
  const root = configured.replace(/\/(education|account)$/, "") || "hrms";
  return `${root}/${type}`;
};

const uploadOptionsFor = (file, type = "education") => {
  const folder = folderFor(type);
  const baseId = `${Date.now()}-${safeBaseName(file.originalname)}`;
  const kind = detectKind(file);

  if (!kind) {
    throw rejectFile(
      "This file is not a valid PDF, image, Word, or Excel file"
    );
  }

  if (kind === "pdf") {
    return {
      folder,
      resource_type: "image",
      public_id: baseId,
      format: "pdf",
      use_filename: false,
      unique_filename: false,
    };
  }

  if (kind === "doc" || kind === "docx" || kind === "xls" || kind === "xlsx") {
    return {
      folder,
      resource_type: "raw",
      public_id: `${baseId}.${kind}`,
      use_filename: false,
      unique_filename: false,
    };
  }

  return {
    folder,
    resource_type: "image",
    public_id: baseId,
    use_filename: false,
    unique_filename: false,
  };
};

/**
 * Upload a multer file buffer to Cloudinary.
 * @returns {{ url, publicId, originalName }}
 */
const uploadToCloudinary = (file, type = "education") => {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
      return reject(
        new Error(
          "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env"
        )
      );
    }

    let options;
    try {
      options = uploadOptionsFor(file, type);
    } catch (err) {
      return reject(err);
    }
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve({
        url: result.secure_url,
        publicId: result.public_id,
        originalName: file.originalname,
        folder: options.folder,
      });
    });
    stream.end(file.buffer);
  });
};

module.exports = {
  UPLOAD_TYPES,
  uploadFile,
  uploadToCloudinary,
  cloudinary,
};
