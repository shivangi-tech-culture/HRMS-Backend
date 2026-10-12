/**
 * UPLOAD MIDDLEWARE — multer (memory) → Cloudinary secure URL
 * Field "document", max 5 MB.
 * Types: education | account | leave | profile → hrms/<type>.
 * profile accepts images only (JPEG, PNG, WEBP, GIF).
 */
const multer = require("multer");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** MIME types accepted by the multer fileFilter */
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
const UPLOAD_TYPES = ["education", "account", "leave", "profile"];

const IMAGE_KINDS = new Set(["jpg", "png", "gif", "webp"]);

/** Multer: single field "document", max 5 MB, memory storage */
const uploadFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, image, Word, or Excel files are allowed"), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("document");

/** Safe base name (no extension) for Cloudinary public_id */
const safeBaseName = (originalName) =>
  path
    .parse(originalName || "file")
    .name.replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "file";

/** Detect real file type from bytes (not just extension) */
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

/** Build a 400-style Error for invalid file content */
const rejectFile = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/** Cloudinary folder: hrms/education, hrms/account, hrms/leave, or hrms/profile */
const folderFor = (type) => {
  const configured = (process.env.CLOUDINARY_FOLDER || "hrms").replace(/\/+$/, "");
  const root = configured.replace(/\/(education|account|leave|profile)$/, "") || "hrms";
  return `${root}/${type}`;
};

/** Cloudinary upload options per real file type */
const uploadOptionsFor = (file, type = "education") => {
  const folder = folderFor(type);
  const baseId = `${Date.now()}-${safeBaseName(file.originalname)}`;
  const kind = detectKind(file);

  if (!kind) {
    throw rejectFile(
      "This file is not a valid PDF, image, Word, or Excel file"
    );
  }

  if (type === "profile" && !IMAGE_KINDS.has(kind)) {
    throw rejectFile("Profile image must be JPEG, PNG, WEBP, or GIF");
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
  uploadFile,
  uploadToCloudinary,
  deleteProfileImage,
  forgetProfileImage,
  isProfileImageUrl,
  folderFor,
  cloudinary,
};
