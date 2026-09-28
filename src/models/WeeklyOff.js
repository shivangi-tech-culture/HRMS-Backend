/**
 * WEEKLY OFF POLICY — Work → Weekly Off
 * UI: Policy Name, Code, Working Days, Week Starts On
 */
const mongoose = require("mongoose");

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
    name: { type: String, default: "" }, // e.g. 5 Day Week
    code: { type: String, default: "" }, // 5DAY
    company: { type: String, default: "" },
    workingDays: { type: Number, default: 5 },
    weekStartsOn: { type: String, default: "Monday" },
    /** Off days 0=Sun … 6=Sat derived or set explicitly */
    offDays: { type: [Number], default: [0, 6] },
    status: { type: String, default: "Active" },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

weeklyOffSchema.index(
  { company: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("WeeklyOff", weeklyOffSchema);
module.exports.WEEK_DAYS = WEEK_DAYS;
