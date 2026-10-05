/**
 * COMPANY MODULE — org setup (branches → shifts → monthly week schedule)
 * Not a Masters dropdown. Collection `companyorgs`.
 * Users store official.companyIds (Company _id). Name is read from this document.
 *
 * Access: Super Admin and Admin only. HR and other roles have no Company module.
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
    day: {
      type: String,
      enum: WEEK_DAYS,
      required: true,
    },
    isOff: {
      type: Boolean,
      default: false,
    },
    startTime: {
      type: String,
      default: "",
    },
    endTime: {
      type: String,
      default: "",
    },
    breakStartTime: {
      type: String,
      default: "",
    },
    breakEndTime: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const weekScheduleSchema = new mongoose.Schema(
  {
    weekNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    days: {
      type: [dayScheduleSchema],
      default: [],
    },
  },
  { _id: false }
);

const shiftSchema = new mongoose.Schema(
  {
    shiftName: {
      type: String,
      required: true,
      trim: true,
    },
    shiftCode: {
      type: String,
      required: true,
      trim: true,
    },
    monthlySchedule: {
      type: [weekScheduleSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

const branchSchema = new mongoose.Schema(
  {
    branchName: {
      type: String,
      required: true,
      trim: true,
    },
    branchCode: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    state: {
      type: String,
      default: "",
    },
    shifts: {
      type: [shiftSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

const companySchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    companyCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    branches: {
      type: [branchSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "companyorgs",
  }
);

companySchema.index({ companyName: 1 });
companySchema.index({ isActive: 1 });

module.exports = mongoose.model("Company", companySchema);
module.exports.WEEK_DAYS = WEEK_DAYS;
