/**
 * ActivityLog — who changed which employee, field by field
 *
 * employee{} = jis pe change hua
 * actor{}    = jisne change kiya
 * changes[]  = { field, label, from, to } per changed field
 */
const mongoose = require("mongoose");

const personRefSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    officialEmail: { type: String, default: "" },
    employeeCode: { type: String, default: "" },
    role: { type: String, default: "" },
    company: { type: String, default: "" },
    department: { type: String, default: "" },
    designation: { type: String, default: "" },
  },
  { _id: false }
);

const activityLogSchema = new mongoose.Schema(
  {
    /** Target employee (profile that was changed) */
    employee: {
      type: personRefSchema,
      required: true,
    },
    /** Who performed the action */
    actor: {
      type: personRefSchema,
      required: true,
    },
    /**
     * create | update | delete | section_update | section_delete
     */
    action: {
      type: String,
      required: true,
      enum: ["create", "update", "delete", "section_update", "section_delete"],
      index: true,
    },
    /** personal | official | accounts | payroll | … (empty on full create/delete) */
    section: { type: String, default: "" },
    /** UI line: "Shivangi Gupta updated employee Vivek Thakur" */
    summary: { type: String, default: "" },
    /** Field-level diff: [{ field, label, from, to, itemId? }] */
    changes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Extra bag (optional) */
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Employee's company names at log time (display only, same as employee.company) */
    company: { type: String, default: "", index: true },
    /** Employee's official.companyIds at log time — company-wise filter */
    companyIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Company" }],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ "employee.id": 1, createdAt: -1 });
activityLogSchema.index({ "actor.id": 1, createdAt: -1 });
activityLogSchema.index({ company: 1, createdAt: -1 });
activityLogSchema.index({ companyIds: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
