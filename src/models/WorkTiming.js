/**
 * WORK TIMING — Work → Work Timings
 * UI: Timing Name, Code, WH Calculation, Grace Time (Mins)
 */
const mongoose = require("mongoose");

const WH_CALCULATIONS = ["Shift Based", "Fixed Hours", "Flexible"];

const workTimingSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" }, // Timing Name e.g. Standard Time
    code: { type: String, default: "" }, // ST, FH, FX
    company: { type: String, default: "" },
    whCalculation: { type: String, default: "Shift Based" },
    graceTimeMins: { type: Number, default: 15 },
    status: { type: String, default: "Active" },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

workTimingSchema.index(
  { company: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("WorkTiming", workTimingSchema);
module.exports.WH_CALCULATIONS = WH_CALCULATIONS;
