/**
 * CHAT READ STATE MODEL — unread count per (conversation, person)
 */
const mongoose = require("mongoose");

const readStateSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatConversation",
      required: true,
    },
    /** User _id of the reader */
    employeeId: { type: String, required: true, trim: true },
    lastReadAt: { type: Date, default: null },
    unreadCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

readStateSchema.index({ conversationId: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model("ChatRead", readStateSchema);
