/**
 * WEEKLY OFF POLICY — Work → Weekly Off
 *
 * UI: Policy Name, Code, Working Days, Week Starts On
 * Assign Shift stores only this doc's _id (weeklyOffPolicy).
 * Punch / timesheet use offDays after populate.
 *
 * offDays: 0=Sunday … 6=Saturday (e.g. [0,6] = Sun+Sat)
 */
const mongoose = require("mongoose");

/** Day names for UI / helpers */
const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const weeklyOffSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" }, // display e.g. "5 Day Week" / "Sat, Sun"
    code: { type: String, default: "" }, // short e.g. 5DAY
    company: { type: String, default: "" }, // company scope
    workingDays: { type: Number, default: 5 }, // how many working days in week
    weekStartsOn: { type: String, default: "Monday" }, // calendar week start
    /** Actual off weekdays used by dayTypeOf → WeeklyOff status */
    offDays: { type: [Number], default: [0, 6] },
    status: { type: String, default: "Active" }, // Active | Inactive
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

/** Unique policy code per company */
weeklyOffSchema.index(
  { company: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("WeeklyOff", weeklyOffSchema);
module.exports.WEEK_DAYS = WEEK_DAYS;
