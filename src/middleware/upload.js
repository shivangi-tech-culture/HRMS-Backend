/**
 * UPLOAD MIDDLEWARE — multer (memory) → Cloudinary secure URL
 * Field "document", max 5 MB.
 * Types: education | account | leave | profile | regularization | onTour | onDuty | companyLogo → hrms/<type>.
 * Allowed files: PDF, JPEG, PNG, WEBP, GIF, and Excel (.xls / .xlsx).
 * The check uses file bytes, not the name the browser sends.
 * profile and companyLogo accept images only. Macro Excel is rejected.
 */
const multer = require("multer");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_MESSAGE = "Only PDF, image, or Excel files are allowed";

/** Extension must match the bytes. octet-stream and Word are not accepted. */
const allowedExt = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".xls", ".xlsx"]);

/** Allowed attachment kinds. Folder on Cloudinary is hrms/<type>. */
const UPLOAD_TYPES = [
  "education",
  "account",
  "leave",
  "profile",
  "regularization",
  "onTour",
  "onDuty",
  "companyLogo",
];

/** Images only. PDF and Excel are rejected for these types. */
const IMAGE_ONLY_TYPES = new Set(["profile", "companyLogo"]);

const IMAGE_KINDS = new Set(["jpg", "png", "gif", "webp"]);

/** Multer: single field "document", max 5 MB, memory storage */
const uploadFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();
    if (!allowedExt.has(ext) || mime.startsWith("text/") || mime.includes("javascript") || mime.includes("html")) {
      cb(new Error(ALLOWED_MESSAGE), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("document");

/** Safe base name (no extension) for Cloudinary public_id */
const safeBaseName = (originalName) =>
  path
    .parse(originalName || "file")
    .name.replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "file";

const hasUtf16 = (buf, text) => buf.includes(Buffer.from(text, "utf16le"));

/** Names stored inside an xlsx zip. A renamed script archive has none of these. */
const xlsxEntries = (buf) => {
  const names = [];
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return names;
  let p = buf.readUInt32LE(eocd + 16);
  const end = Math.min(buf.length, p + buf.readUInt32LE(eocd + 12));
  while (p + 46 <= end && buf.readUInt32LE(p) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.slice(p + 46, p + 46 + nameLen).toString("utf8").replace(/\\/g, "/"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
};

const isSafeXlsx = (buf) => {
  const names = xlsxEntries(buf);
  if (!names.includes("xl/workbook.xml")) return false;
  const safeExt = new Set([".xml", ".rels", ".jpg", ".jpeg", ".png", ".gif", ".emf", ".wmf"]);
  return names.every((name) => {
    if (!name || name.includes("..") || name.startsWith("/") || name.includes("\0")) return false;
    if (/vba|macro/i.test(name)) return false;
    if (name === "[Content_Types].xml") return true;
    if (!/^(xl\/|_rels\/|docProps\/)/.test(name)) return false;
    const ext = path.extname(name).toLowerCase();
    if (ext === ".bin") return /printerSettings\.bin$/i.test(name);
    return !ext || safeExt.has(ext);
  });
};

/**
 * Real type from bytes. A script renamed to .pdf or .xlsx returns null.
 * Excel with macros returns null.
 */
const detectKind = (file) => {
  const buf = file.buffer || Buffer.alloc(0);
  if (buf.length < 4) return null;
  if (buf.slice(0, 5).toString() === "%PDF-") return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.slice(0, 4).toString("hex") === "89504e47") return "png";
  const gif = buf.slice(0, 6).toString();
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(0, 8).toString("hex") === "d0cf11e0a1b11ae1") {
    if (hasUtf16(buf, "WordDocument") || hasUtf16(buf, "_VBA_PROJECT")) return null;
    if (hasUtf16(buf, "Workbook") || hasUtf16(buf, "Book")) return "xls";
    return null;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && isSafeXlsx(buf)) {
    return "xlsx";
  }
  return null;
};

/** Kind must agree with the extension. Exported so chat and mail use the same rule. */
const kindForUpload = (file) => {
  const ext = path.extname(String(file?.originalname || "")).toLowerCase();
  const kind = detectKind(file);
  const matches =
    (kind === "pdf" && ext === ".pdf") ||
    (kind === "jpg" && (ext === ".jpg" || ext === ".jpeg")) ||
    (kind === "png" && ext === ".png") ||
    (kind === "gif" && ext === ".gif") ||
    (kind === "webp" && ext === ".webp") ||
    (kind === "xls" && ext === ".xls") ||
    (kind === "xlsx" && ext === ".xlsx");
  return matches ? kind : null;
};

/** Build a 400-style Error for invalid file content */
const rejectFile = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/** Cloudinary folder: hrms/<type>, including hrms/profile and hrms/companyLogo */
const folderFor = (type) => {
  const configured = (process.env.CLOUDINARY_FOLDER || "hrms").replace(/\/+$/, "");
  const root =
    configured.replace(
      /\/(education|account|leave|profile|regularization|onTour|onDuty|companyLogo)$/,
      ""
    ) || "hrms";
  return `${root}/${type}`;
};

/** Cloudinary upload options per real file type */
const uploadOptionsFor = (file, type = "education") => {
  const folder = folderFor(type);
  const baseId = `${Date.now()}-${safeBaseName(file.originalname)}`;
  const kind = kindForUpload(file);

  if (!kind) {
    throw rejectFile("This file is not a valid PDF, image, or Excel file");
  }

  if (IMAGE_ONLY_TYPES.has(type) && !IMAGE_KINDS.has(kind)) {
    const label = type === "companyLogo" ? "Company logo" : "Profile image";
    throw rejectFile(`${label} must be JPEG, PNG, WEBP, or GIF`);
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

  if (kind === "xls" || kind === "xlsx") {
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

/** Upload multer buffer to Cloudinary; returns secure URL */
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
        folder: options.folder,
      });
    });
    stream.end(file.buffer);
  });
};

/** public_id from a Cloudinary delivery URL (extension stripped; images store it that way) */
const publicIdFromUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    return "";
  }
  const marker = "/upload/";
  const at = parsed.pathname.indexOf(marker);
  if (at < 0) return "";
  let rest = decodeURIComponent(parsed.pathname.slice(at + marker.length));
  rest = rest.replace(/^v\d+\//, "");
  return rest.replace(/\.[a-z0-9]+$/i, "");
};

/** True when the URL is an image we stored under hrms/profile */
const isProfileImageUrl = (url) => {
  const publicId = publicIdFromUrl(url);
  return Boolean(publicId && publicId.startsWith(`${folderFor("profile")}/`));
};

/** Remove one profile image from Cloudinary. Other folders are rejected. */
const deleteProfileImage = async (url) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    throw new Error(
      "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env"
    );
  }
  const publicId = publicIdFromUrl(url);
  if (!publicId || !publicId.startsWith(`${folderFor("profile")}/`)) {
    throw rejectFile("Only a profile image uploaded to this app can be deleted");
  }
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });
  if (result?.result !== "ok" && result?.result !== "not found") {
    throw new Error("Could not delete profile image");
  }
  return { publicId };
};

/**
 * After profileUrl is replaced or cleared, drop the previous Cloudinary file.
 * A failed delete does not fail the profile save.
 */
const forgetProfileImage = async (previous, next = "") => {
  const prev = String(previous || "").trim();
  const nxt = String(next || "").trim();
  if (!prev || prev === nxt || !isProfileImageUrl(prev)) return;
  try {
    await deleteProfileImage(prev);
  } catch (err) {
    console.error("Profile image delete failed:", err.message || err);
  }
};

module.exports = {
  UPLOAD_TYPES,
  ALLOWED_MESSAGE,
  kindForUpload,
  uploadFile,
  uploadToCloudinary,
  deleteProfileImage,
  forgetProfileImage,
  isProfileImageUrl,
  folderFor,
  cloudinary,
};
