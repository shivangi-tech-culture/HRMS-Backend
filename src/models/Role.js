/**
 * Role — name, status, permissions matrix
 * Validation → validators/role.validation.js
 */
const mongoose = require("mongoose");

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
    name: { type: String, default: "" },
    ...actionFlags,
  },
  { _id: false }
);

const permissionBlockSchema = new mongoose.Schema(
  {
    module: { type: String, default: "" },
    heading: { type: String, default: "" },
    subModules: { type: [subModulePermSchema], default: [] },
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" }, // matches User.role
    description: { type: String, default: "" },
    status: { type: String, default: "Active" }, // Active | Inactive (Joi)
    /** Which permission tree this role uses — set at create (admin | employee) */
    catalog: {
      type: String,
      enum: ["admin", "employee"],
      default: "admin",
    },
    permissions: { type: [permissionBlockSchema], default: [] },
  },
  { timestamps: true }
);

roleSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model("Role", roleSchema);
