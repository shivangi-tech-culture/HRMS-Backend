/**
 * Master — dropdown catalogs (one file, many Mongo collections by `type`)
 *
 * type → collection: company→companies, department→departments,
 *   designation→designations, division→divisions, employeeGroup→employeegroups
 *
 * Schema = data shape only. Request rules → validators/master.validation.js
 * Employee forms save `name` string (not _id).
 */
const mongoose = require("mongoose");

const TYPES = [
  "company",
  "department",
  "designation",
  "division",
  "employeeGroup",
];

const COLLECTION_BY_TYPE = {
  company: "companies",
  department: "departments",
  designation: "designations",
  division: "divisions",
  employeeGroup: "employeegroups",
};

const isCompanyType = (type) => type === "company";

/** Mongoose model for this type’s collection (cached) */
const getModel = (type) => {
  if (!TYPES.includes(type)) {
    throw new Error(`Invalid master type: ${type}`);
  }

  const collection = COLLECTION_BY_TYPE[type];
  const modelName = `Master_${collection}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];

  const schema = new mongoose.Schema(
    {
      name: { type: String, default: "" }, // dropdown label
      company: { type: String, default: "" }, // parent company; "" for type=company
      status: { type: String, default: "Active" }, // Active | Inactive (Joi)
    },
    { timestamps: true, collection }
  );

  if (isCompanyType(type)) {
    schema.index(
      { name: 1 },
      { unique: true, collation: { locale: "en", strength: 2 } }
    );
  } else {
    schema.index(
      { company: 1, name: 1 },
      { unique: true, collation: { locale: "en", strength: 2 } }
    );
    schema.index({ company: 1, status: 1 });
  }

  return mongoose.model(modelName, schema, collection);
};

/** Add `type` on API response */
const toMasterDto = (type, doc) => {
  if (!doc) return null;
  const row = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    ...row,
    type,
    company: isCompanyType(type) ? "" : row.company || "",
  };
};

/** Find row by _id across all master collections */
const findMasterById = async (id) => {
  for (const type of TYPES) {
    const Model = getModel(type);
    const row = await Model.findById(id);
    if (row) return { type, Model, row };
  }
  return null;
};

const findMasterByIdLean = async (id) => {
  for (const type of TYPES) {
    const Model = getModel(type);
    const row = await Model.findById(id).lean();
    if (row) return { type, row: toMasterDto(type, row) };
  }
  return null;
};

/** Clear all master collections (seed) */
const clearAllMasterCollections = async () => {
  await Promise.all(TYPES.map((type) => getModel(type).deleteMany({})));
};

module.exports = {
  TYPES,
  COLLECTION_BY_TYPE,
  isCompanyType,
  getModel,
  toMasterDto,
  findMasterById,
  findMasterByIdLean,
  clearAllMasterCollections,
};
