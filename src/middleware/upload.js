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
 * PDF upload: resource_type "image" + format pdf (Cloudinary recommended for viewable PDFs)
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
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Allowed attachment kinds. Folder on Cloudinary is hrms/<type>. */
const UPLOAD_TYPES = ["education", "account"];

/** Common file parser for every type. Field name: "document" — max 5 MB */
const uploadFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, JPG, PNG or DOC files are allowed"), false);
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
 * Upload options per file type.
 * PDF → image + format pdf → opens in browser, URL ends with .pdf once
 * DOC → raw + extension in public_id (download only)
 * JPG/PNG → image
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
  const mime = file.mimetype;

  if (mime === "application/pdf") {
    return {
      folder,
      resource_type: "image",
      public_id: baseId,
      format: "pdf",
      pages: true,
      use_filename: false,
      unique_filename: false,
    };
  }

  if (mime === "application/msword") {
    return {
      folder,
      resource_type: "raw",
      public_id: `${baseId}.doc`,
      use_filename: false,
      unique_filename: false,
    };
  }

  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return {
      folder,
      resource_type: "raw",
      public_id: `${baseId}.docx`,
      use_filename: false,
      unique_filename: false,
    };
  }

  // jpg / png
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

    const options = uploadOptionsFor(file, type);
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
