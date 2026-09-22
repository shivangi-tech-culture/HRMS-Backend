/**
 * Role model
 *
 * Stores role name, status, and flat permission blocks:
 *   { module, heading, subModules: [{ name, view, create, … }] }
 */
const mongoose = require("mongoose");

/** Action flags stored on each submodule */
const actionFlags = {
  view: { type: Boolean, default: false },
  create: { type: Boolean, default: false },
  edit: { type: Boolean, default: false },
  delete: { type: Boolean, default: false },
  approve: { type: Boolean, default: false },
  reject: { type: Boolean, default: false },
  cancel: { type: Boolean, default: false },
  assign: { type: Boolean, default: false },
  download: { type: Boolean, default: false },
  export: { type: Boolean, default: false },
  import: { type: Boolean, default: false },
  upload: { type: Boolean, default: false },
  print: { type: Boolean, default: false },
  email: { type: Boolean, default: false },
  share: { type: Boolean, default: false },
};

const subModulePermSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ...actionFlags,
  },
  { _id: false }
);

/** One permission block: module + heading + list of submodules */
const permissionBlockSchema = new mongoose.Schema(
  {
    module: { type: String, required: true },
    heading: { type: String, default: "" }, // empty allowed for Employee
    subModules: { type: [subModulePermSchema], default: [] },
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
      required: true,
    },
    permissions: { type: [permissionBlockSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Role", roleSchema);
