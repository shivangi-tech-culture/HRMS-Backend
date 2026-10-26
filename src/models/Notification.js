/**
 * In-app + push notification (source of truth).
 * FCM delivers the alert; this collection powers the bell / history.
 */
const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  "PROFILE_COMPLETION",
  "GENERAL",
  "LEAVE",
  "ATTENDANCE",
  "TASK",
  "ANNOUNCEMENT",
];

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      default: "GENERAL",
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    /** Extra payload for deep-link / UI (percentage, ids, …) */
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    /** FCM delivery attempt result (best-effort) */
    pushSent: { type: Boolean, default: false },
    pushError: { type: String, default: "" },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
