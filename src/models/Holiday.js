/**
 * HOLIDAY — Work → Holiday Calendar
 * UI: Holiday name, Date, Type (NATIONAL / DECLARED), For (All Employees)
 */
const mongoose = require("mongoose");

const HOLIDAY_TYPES = ["NATIONAL HOLIDAY", "DECLARED HOLIDAY"];

const holidaySchema = new mongoose.Schema(
  {
    name: { type: String, default: "" }, // e.g. Republic Day
    date: { type: String, default: "" }, // YYYY-MM-DD
    type: { type: String, default: "DECLARED HOLIDAY" },
    /** Audience label — UI "For" column */
    forAudience: { type: String, default: "All Employees" },
    /** Optional tags / applicable on */
    applicableOn: { type: String, default: "" },
    company: { type: String, default: "" },
    year: { type: Number, default: null },
    status: { type: String, default: "Active" },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

holidaySchema.index(
  { company: 1, date: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
holidaySchema.index({ company: 1, year: 1, status: 1 });

module.exports = mongoose.model("Holiday", holidaySchema);
module.exports.HOLIDAY_TYPES = HOLIDAY_TYPES;
