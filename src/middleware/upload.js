/**
 * File upload — education documents via Cloudinary
 *
 * Flow: multer (memory) → upload stream to Cloudinary → return secure URL
 *
 * Env (add your credentials in .env):
 *   CLOUDINARY_CLOUD_NAME=
 *   CLOUDINARY_API_KEY=
 *   CLOUDINARY_API_SECRET=
 *   CLOUDINARY_FOLDER=hrms/education   (optional)
 */
const multer = require("multer");
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

/** Multer field name: "document" — max 5 MB */
const uploadEducationDoc = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, JPG, PNG or DOC files are allowed"), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("document");

/**
 * Upload a multer file buffer to Cloudinary.
 * @returns {{ url, publicId, originalName }}
 */
const uploadToCloudinary = (file) => {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
      return reject(
        new Error(
          "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env"
        )
      );
    }

    const folder = process.env.CLOUDINARY_FOLDER || "hrms/education";
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",
        public_id: `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          originalName: file.originalname,
        });
      }
    );
    stream.end(file.buffer);
  });
};

module.exports = { uploadEducationDoc, uploadToCloudinary, cloudinary };
