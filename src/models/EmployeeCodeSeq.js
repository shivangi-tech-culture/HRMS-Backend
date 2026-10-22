/**
 * Per-company employee-code counter.
 * seq is the last number already handed out for this companyCode.
 * Preview reads it; create increments it. A company-code change starts a new run.
 */
const mongoose = require("mongoose");

const employeeCodeSeqSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    companyCode: { type: String, required: true, trim: true, uppercase: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { collection: "employeecodeseqs" }
);

module.exports = mongoose.model("EmployeeCodeSeq", employeeCodeSeqSchema);
