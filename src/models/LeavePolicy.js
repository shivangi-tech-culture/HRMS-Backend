/**
 * Leave policy rules.
 * scope "common"  → one row for every company (companyId empty).
 * scope "company" → that company only. Same key replaces the common row on their screen.
 * hidden on a company row means this company removed that common rule. Common stays.
 */
const mongoose = require("mongoose");

const leavePolicySchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["common", "company"], default: "company" },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    value: { type: String, default: "" },
    description: { type: String, default: "" },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

leavePolicySchema.index(
  { key: 1 },
  { unique: true, partialFilterExpression: { scope: "common" } }
);
leavePolicySchema.index(
  { companyId: 1, key: 1 },
  { unique: true, partialFilterExpression: { scope: "company" } }
);

module.exports = mongoose.model("LeavePolicy", leavePolicySchema);
