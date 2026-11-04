/**
 * Company-scoped work project. Create project first, then tasks under it.
 * members[] = people on the project team (optional).
 * Collection: projects.
 */
const mongoose = require("mongoose");

const PROJECT_STATUSES = ["Active", "Inactive"];

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    status: {
      type: String,
      enum: PROJECT_STATUSES,
      default: "Active",
    },
    /** Employees / users attached to this project team. */
    members: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, collection: "projects" }
);

projectSchema.index({ companyId: 1, status: 1, name: 1 });
projectSchema.index({ name: 1 });

module.exports = mongoose.model("Project", projectSchema);
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
