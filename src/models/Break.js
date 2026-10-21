/**
 * BREAK SESSION — one row per break an employee starts.
 * Lunch Break is 30 minutes. Day Break has no time limit.
 * Live Overdue is only for Lunch Break past 30 minutes.
 */
const mongoose = require("mongoose");

/**
 * Saved on the break row.
 * On Break / Overdue = still open.
 * Completed = ended inside today's remaining balance.
 * Pending / Approved / Rejected = ended past the balance; reporting manager reviews it.
 * At Desk is not stored — it means the person has no open break.
 */
const STORED_STATUSES = [
  "On Break",
  "Overdue",
  "Completed",
  "Pending",
  "Approved",
  "Rejected",
];

const breakSessionSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    /** Snapshot at start — history filters do not follow later profile edits */
    department: { type: String, default: "" },
    shiftId: { type: mongoose.Schema.Types.ObjectId, default: null },
    shiftName: { type: String, default: "" },
    /** Lunch Break (30 min) or Day Break (no limit) */
    breakType: { type: String, required: true, trim: true },
    /** Calendar day YYYY-MM-DD */
    date: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    /** Null on Day Break — no minute cap. Lunch Break stores 30. */
    allowedMinutes: { type: Number, default: null },
    durationMinutes: { type: Number, default: 0 },
    /**
     * On Break — open, still inside the balance this break started with.
     * Overdue — open Lunch Break after 30 minutes. Written on the row.
     * Completed — ended inside the remaining daily balance.
     * Pending — ended past the balance, waiting for the reporting manager.
     * Approved / Rejected — manager decision on a Pending break.
     */
    status: { type: String, enum: STORED_STATUSES, default: "On Break" },
    reviewNote: { type: String, default: "" },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    endedBy: { type: String, enum: ["employee", "admin", null], default: null },
    endedByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

breakSessionSchema.index({ employee: 1, date: -1 });
breakSessionSchema.index({ date: 1, status: 1 });
breakSessionSchema.index({ date: 1, endedAt: 1 });
breakSessionSchema.index({ department: 1, date: -1 });
/** One open break per employee */
breakSessionSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { endedAt: null } }
);

const BreakSession = mongoose.model("BreakSession", breakSessionSchema, "breaksessions");

module.exports = BreakSession;
module.exports.STORED_STATUSES = STORED_STATUSES;
