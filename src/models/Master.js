/**
 * Master — dropdown catalogs (global across all companies)
 *
 * type=company → list of companies (tenant names)
 * all other types → shared globally (no company column / filter)
 *
 * Employee forms save `name` string (not _id).
 */
const mongoose = require("mongoose");

const TYPES = [
  "company",
  "department",
  "designation",
  "division",
  "employeeGroup",
  "grade",
  "jobRole",
  "gender",
  "maritalStatus",
  "bloodGroup",
  "country",
  "state",
  "city",
  "courseType",
  "courseLevel",
  "bankName",
  "relation",
  "nominateFor",
  "visaType",
  "regularizationReason",
  "markAttendanceReason",
];

const COLLECTION_BY_TYPE = {
  company: "companies",
  department: "departments",
  designation: "designations",
  division: "divisions",
  employeeGroup: "employeegroups",
  grade: "grades",
  jobRole: "jobroles",
  gender: "genders",
  maritalStatus: "maritalstatuses",
  bloodGroup: "bloodgroups",
  country: "countries",
  state: "states",
  city: "cities",
  courseType: "coursetypes",
  courseLevel: "courselevels",
  bankName: "banknames",
  relation: "relations",
  nominateFor: "nominatefors",
  visaType: "visatypes",
  regularizationReason: "regularizationreasons",
  markAttendanceReason: "markattendancereasons",
};

const GENERAL_INFO_DROPDOWNS = {
  personal: {
    gender: "gender",
    maritalStatus: "maritalStatus",
    "presentAddress.country": "country",
    "presentAddress.state": "state",
    "presentAddress.city": "city",
    "permanentAddress.country": "country",
    "permanentAddress.state": "state",
    "permanentAddress.city": "city",
  },
  official: {
    company: "company",
    department: "department",
    designation: "designation",
    division: "division",
    employeeGroup: "employeeGroup",
    grade: "grade",
    jobRole: "jobRole",
  },
  other: {
    bloodGroup: "bloodGroup",
  },
  education: {
    courseType: "courseType",
    courseLevel: "courseLevel",
  },
  accounts: {
    bankName: "bankName",
  },
  family: {
    relation: "relation",
  },
  nominees: {
    nominateFor: "nominateFor",
    relation: "relation",
  },
  experience: {
    designation: "designation",
  },
  visas: {
    countryName: "country",
    visaType: "visaType",
  },
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
      name: { type: String, default: "" },
      /** Legacy field — always "" now (masters are global) */
      company: { type: String, default: "" },
      status: { type: String, default: "Active" },
    },
    { timestamps: true, collection }
  );

  // Global uniqueness by name (not per-company)
  schema.index(
    { name: 1 },
    { unique: true, collation: { locale: "en", strength: 2 } }
  );
  schema.index({ status: 1 });

  return mongoose.model(modelName, schema, collection);
};

/** API DTO — omit company for UI (masters are global) */
const toMasterDto = (type, doc) => {
  if (!doc) return null;
  const row = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const { company, ...rest } = row;
  return {
    ...rest,
    type,
  };
};

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

const clearAllMasterCollections = async () => {
  await Promise.all(TYPES.map((type) => getModel(type).deleteMany({})));
};

module.exports = {
  TYPES,
  COLLECTION_BY_TYPE,
  GENERAL_INFO_DROPDOWNS,
  isCompanyType,
  getModel,
  toMasterDto,
  findMasterById,
  findMasterByIdLean,
  clearAllMasterCollections,
};
