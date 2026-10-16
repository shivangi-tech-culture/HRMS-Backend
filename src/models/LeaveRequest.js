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
    /** Selected days only. Gaps between from and to are not leave. */
    dates: [
      {
        date: { type: String, required: true },
        dayType: {
          type: String,
          enum: ["Full Day", "First Half", "Second Half"],
          default: "Full Day",
        },
        days: { type: Number, default: 1 },
        paid: { type: Boolean, default: true },
        /** Days of this date taken from a Casual Leave adjustment. */
        adjustment: { type: Number, default: 0 },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
      },
    ],
    days: { type: Number, required: true },
    /** Days covered by the selected paid type. Missing on older requests. */
    paidDays: { type: Number },
    /** Days moved to Unpaid Leave because the paid balance was finished. */
    unpaidDays: { type: Number },
    /** Salary days to deduct. Same as unpaidDays. */
    deduction: { type: Number },
    /** Unpaid Leave type that holds the deducted days. */
    unpaidLeaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", default: null },
    /** Days of this request taken from an adjustment, usable in any quarter. */
    adjustmentDays: { type: Number, default: 0 },
    dayType: { type: String, enum: ["Full Day", "First Half", "Second Half"], default: "Full Day" },
    reason: { type: String, default: "" },
    document: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Partial", "Cancelled"],
      default: "Pending",
    },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
  },
  { timestamps: true }
);

leaveRequestSchema.pre("validate", function () {
  if (this.dayType === "Half Day") this.dayType = "First Half";
  for (const row of this.dates || []) {
    if (row.dayType === "Half Day") row.dayType = "First Half";
  }
});

leaveRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ employee: 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ companyId: 1, from: 1, to: 1, status: 1 });

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
