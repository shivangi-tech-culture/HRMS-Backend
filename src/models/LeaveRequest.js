/**
 * One leave application.
 * Employee name and leave type name are read from User and LeaveType, not copied here.
 */
const mongoose = require("mongoose");

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    days: { type: Number, required: true },
    dayType: { type: String, enum: ["Full Day", "Half Day"], default: "Full Day" },
    reason: { type: String, default: "" },
    document: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ employee: 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ companyId: 1, from: 1, to: 1, status: 1 });

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
