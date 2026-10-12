/**
 * One row = one employee asking to fix one day.
 * Status: Pending → Approved (day becomes Present) or Rejected (day stays Absent).
 */
const mongoose = require("mongoose");

const attendanceRegularizationSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    date: { type: String, required: true }, // YYYY-MM-DD
    punchInTime: { type: String, default: "" }, // HH:mm
    punchOutTime: { type: String, default: "" },
    reason: { type: String, default: "" },
    remarks: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
  },
  { timestamps: true }
);

attendanceRegularizationSchema.index({ employee: 1, date: -1, createdAt: -1 });
attendanceRegularizationSchema.index(
  { employee: 1, date: 1 },
  { unique: true, partialFilterExpression: { status: "Pending" } }
);

module.exports = mongoose.model("AttendanceRegularization", attendanceRegularizationSchema);
