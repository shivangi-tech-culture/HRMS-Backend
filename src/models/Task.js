/**
 * Work task under a company project.
 * Flow: create Project (company) → create Task (projectId) → Assign assignees.
 * Collection: tasks.
 */
const mongoose = require("mongoose");

const PRIORITIES = ["High", "Medium", "Low"];
/** Stored statuses. "Over Due" is derived when dueDate < today and status is not Completed. */
const STATUSES = ["To Do", "In Progress", "Completed"];

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    /** Copied from project on create — used for company-scope filters. */
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    /** One or more Employees. Empty until Assign API / create body. */
    assignees: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** YYYY-MM-DD */
    dueDate: { type: String, default: "", trim: true },
    priority: {
      type: String,
      enum: PRIORITIES,
      default: "Medium",
    },
    status: {
      type: String,
      enum: STATUSES,
      default: "To Do",
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "tasks" }
);

taskSchema.index({ companyId: 1, projectId: 1, status: 1, dueDate: 1 });
taskSchema.index({ assignees: 1, status: 1, dueDate: 1 });
taskSchema.index({ title: 1 });

module.exports = mongoose.model("Task", taskSchema);
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
