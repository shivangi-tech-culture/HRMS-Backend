/**
 * CHAT MESSAGE MODEL — text and/or attachments sent in a ChatConversation
 * Attachment bytes live on Cloudinary (private); storageKey = Cloudinary public_id.
 */
const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 255 },
  size: { type: Number, required: true, min: 0 },
  /** Set by the server from the file extension, never from the browser */
  mimeType: { type: String, required: true },
  storageKey: { type: String, required: true },
});

const messageSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatConversation",
      required: true,
      index: true,
    },
    /** Sender User _id */
    senderId: { type: String, required: true, trim: true },
    text: { type: String, default: "", trim: true, maxlength: 4000 },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ "attachments._id": 1 });

module.exports = mongoose.model("ChatMessage", messageSchema);
