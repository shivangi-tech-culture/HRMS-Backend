/**
 * COMPANY MODULE — org setup. Collection `companyorgs`.
 *
 * Masters hold only names (Noida, Morning Shift).
 * This document holds the real tree: branches → shifts → weekly days/times.
 * User assignment: official.companyIds + branchId + shiftId (one workplace).
 * Catalog (all branches/shifts/days) stays on this document.
 * Attendance reads times from here, not from the user.
 *
 * Access: Super Admin and Admin only.
 */
const mongoose = require("mongoose");

const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const dayScheduleSchema = new mongoose.Schema(
  {
    day: { type: String, enum: WEEK_DAYS, required: true },
    isOff: { type: Boolean, default: false },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    breakStartTime: { type: String, default: "" },
    breakEndTime: { type: String, default: "" },
  },
  { _id: false }
);

const weekScheduleSchema = new mongoose.Schema(
  {
    weekNumber: { type: Number, required: true, min: 1, max: 5 },
    days: { type: [dayScheduleSchema], default: [] },
  },
  { _id: false }
);

const shiftSchema = new mongoose.Schema({
  shiftName: { type: String, required: true, trim: true },
  shiftCode: { type: String, required: true, trim: true, uppercase: true },
  monthlySchedule: { type: [weekScheduleSchema], default: [] },
  isActive: { type: Boolean, default: true },
});

const branchSchema = new mongoose.Schema({
  branchName: { type: String, required: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true },
  address: { type: String, default: "" },
  city: { type: String, default: "" },
  state: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  shifts: { type: [shiftSchema], default: [] },
});

const companySchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    companyCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    isActive: { type: Boolean, default: true },
    branches: { type: [branchSchema], default: [] },
  },
  { timestamps: true, collection: "companyorgs" }
);

companySchema.index({ companyName: 1 });
companySchema.index({ isActive: 1 });

module.exports = mongoose.model("Company", companySchema);
module.exports.WEEK_DAYS = WEEK_DAYS;
