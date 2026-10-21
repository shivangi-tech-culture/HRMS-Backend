/**
 * One On Tour or On Duty application.
 * dutyType decides which one it is: "On Tour" or "On Duty".
 * Pending until a manager, HR, or admin approves it.
 * Approve writes OnTour or OnDuty on each attendance day in the range.
 * Reject and cancel leave those days unchanged.
 */
const mongoose = require("mongoose");

const DUTY_TYPES = ["On Tour", "On Duty"];
const REQUEST_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

const tourDutySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    /** "On Tour" or "On Duty" */
    dutyType: { type: String, enum: DUTY_TYPES, required: true },
    /**
     * Master _id.
     * On Tour → onTourCategory. On Duty → onDutyCategory.
     */
    tourCategory: { type: mongoose.Schema.Types.ObjectId, default: null },
    fromDate: { type: String, required: true },
    fromTime: { type: String, required: true },
    toDate: { type: String, required: true },
    toTime: { type: String, required: true },
    reason: { type: String, default: "" },
    remarks: { type: String, default: "" },
    /** Cloudinary URL. On Tour → upload type=onTour. On Duty → upload type=onDuty. */
    document: { type: String, default: "" },
    status: { type: String, enum: REQUEST_STATUSES, default: "Pending" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
  },
  { timestamps: true }
);

tourDutySchema.index({ employee: 1, fromDate: -1, createdAt: -1 });
tourDutySchema.index({ status: 1, fromDate: 1, toDate: 1 });

module.exports = mongoose.model("TourDuty", tourDutySchema);
module.exports.DUTY_TYPES = DUTY_TYPES;
module.exports.REQUEST_STATUSES = REQUEST_STATUSES;
