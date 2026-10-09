/**
 * Leave type catalog.
 * scope "common"  → one row for every company (companyId empty).
 * scope "company" → one company only.
 * Same code can exist once as common and again for a company.
 * The company row replaces the common row on that company's wallets.
 */
const mongoose = require("mongoose");

const leaveTypeSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["common", "company"], required: true },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    paid: { type: Boolean, default: true },
    maxDays: { type: Number, required: true, min: 0 },
    carryForward: { type: Boolean, default: false },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    /** Company hid this code. The common row with the same code stays. */
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

leaveTypeSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { scope: "common" } }
);
leaveTypeSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { scope: "company" } }
);
leaveTypeSchema.index({ scope: 1, status: 1, name: 1 });

module.exports = mongoose.model("LeaveType", leaveTypeSchema);
