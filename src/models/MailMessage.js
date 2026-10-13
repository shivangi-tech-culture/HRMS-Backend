const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    employeeId: { type: String, default: "" },
    name: { type: String, default: "" },
    email: { type: String, required: true },
    kind: { type: String, enum: ["internal", "external"], required: true },
  },
  { _id: false },
);

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/octet-stream" },
    storageKey: { type: String, required: true },
  },
  { _id: true },
);

const messageSchema = new mongoose.Schema(
  {
    fromEmployeeId: { type: String, default: "" },
    fromName: { type: String, default: "" },
    fromEmail: { type: String, required: true, lowercase: true, trim: true },
    to: { type: [addressSchema], default: [] },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    preview: { type: String, default: "" },
    companyName: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    externalStatus: { type: String, enum: ["none", "sent", "failed"], default: "none" },
    externalError: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MailMessage", messageSchema);
