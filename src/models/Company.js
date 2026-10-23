/**
 * COMPANY MODULE — org setup. Collection `companyorgs`.
 *
 * Branch / shift names + codes live in masters (type=branch|shift), shared by all companies.
 * This document links them: branches[].branchId → shifts[].shiftId → weekly days/times.
 * Address and timings are per company; a branch / shift master appears once per company / branch.
 * User assignment: official.companyIds + branchId + shiftId (same master ids).
 * Attendance reads times from here, not from the user.
 *
 * Access: Super Admin and Admin only.
 */
const mongoose = require("mongoose");
const { getModel, modelNameOf } = require("./Master");

getModel("branch");
getModel("shift");

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

const shiftSchema = new mongoose.Schema(
  {
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: modelNameOf("shift"),
      required: true,
    },
    monthlySchedule: { type: [weekScheduleSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const branchSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: modelNameOf("branch"),
      required: true,
    },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    pincode: { type: String, default: "", trim: true },
    /** Office GPS — auto-filled from address via Map API; punch/break within 50m */
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    shifts: { type: [shiftSchema], default: [] },
  },
  { _id: false }
);

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
    /** Cloudinary URL from upload type companyLogo. Empty until a logo is saved. */
    logo: { type: String, default: "", trim: true },
    /** Calendar year the company was founded. Null until set. */
    foundedYear: {
      type: Number,
      default: null,
      validate: {
        validator: (value) =>
          value == null || (Number.isInteger(value) && value >= 1800 && value <= 2100),
        message: "Founded year must be between 1800 and 2100",
      },
    },
    /**
     * Company month. Default 1 through the last day of that month (30 or 31).
     * A shifted month stores both ends, for example 24 through 23.
     * Casual Leave quarters are three of these months.
     */
    monthStartDay: { type: Number, default: 1, min: 1, max: 28 },
    monthEndDay: { type: Number, default: 31, min: 1, max: 31 },
    branches: { type: [branchSchema], default: [] },
  },
  { timestamps: true, collection: "companyorgs" }
);

companySchema.index({ companyName: 1 });
companySchema.index({ isActive: 1 });
companySchema.index({ "branches.branchId": 1 });
companySchema.index({ "branches.shifts.shiftId": 1 });

/** Populate paths that turn branchId / shiftId into { _id, name, code } */
const MASTER_POPULATE = [
  { path: "branches.branchId", select: "name code" },
  { path: "branches.shifts.shiftId", select: "name code" },
];

module.exports = mongoose.model("Company", companySchema);
module.exports.WEEK_DAYS = WEEK_DAYS;
module.exports.MASTER_POPULATE = MASTER_POPULATE;
