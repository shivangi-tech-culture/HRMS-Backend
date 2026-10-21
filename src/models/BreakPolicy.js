/**
 * Break policies. An employee only sees published ones; any number can be published.
 * Lunch is a fixed duration. A flexible break (5 min, 10 min, …) has no daily count.
 */
const mongoose = require("mongoose");

const breakPolicySchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    minutes: { type: Number, default: null },
    flexible: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

breakPolicySchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { companyId: null } }
);

module.exports = mongoose.model("BreakPolicy", breakPolicySchema);
