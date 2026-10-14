/**
 * Holiday catalog. One row = one holiday (name, date, description, isActive).
 * Companies are assigned on the same document via companyIds.
 * Collection: holidays. Date is unique in the catalog.
 */
const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /** YYYY-MM-DD. Attendance holidayMap uses this string. */
    date: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
    /** Companies this holiday is assigned to. Empty until assign. */
    companyIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Company" }],
      default: [],
    },
  },
  { timestamps: true, collection: "holidays" }
);

holidaySchema.index({ date: 1 }, { unique: true });
holidaySchema.index({ companyIds: 1, isActive: 1, date: 1 });
holidaySchema.index({ name: 1 });

module.exports = mongoose.model("Holiday", holidaySchema);
