const mongoose = require("mongoose");

const mailboxSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "MailMessage", required: true },
    folder: { type: String, enum: ["inbox", "sent", "drafts", "trash"], required: true },
    starred: { type: Boolean, default: false },
    unread: { type: Boolean, default: false },
    snoozedUntil: { type: Date, default: null },
    reminderAt: { type: Date, default: null },
    task: {
      title: { type: String, default: "" },
      dueAt: { type: Date, default: null },
      done: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

mailboxSchema.index({ ownerId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model("Mailbox", mailboxSchema);
