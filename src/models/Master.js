/**
 * Master — dropdown catalogs (one file, many Mongo collections by `type`)
 *
 * Official (org): company, department, designation, division, employeeGroup, grade, jobRole
 * General Info: gender, maritalStatus, bloodGroup, country, state, city,
 *   courseType, courseLevel, bankName, relation, nominateFor, visaType
 *
 * Schema = data shape only. Request rules → validators/master.validation.js
 * Employee forms save `name` string (not _id).
 *
 * ESS General Info (9 modules — no Vaccination):
 *   Personal | Official | Other | Education | Account | Family | Nominee | Experience | Visa
 */
const mongoose = require("mongoose");

const TYPES = [
  // Official / org structure
  "company",
  "department",
  "designation",
  "division",
  "employeeGroup",
  "grade",
  "jobRole",
  // Personal / Other
  "gender",
  "maritalStatus",
  "bloodGroup",
  "country",
  "state",
  "city",
  // Education
  "courseType",
  "courseLevel",
  // Accounts
  "bankName",
  // Family + Nominee
  "relation",
  "nominateFor",
  // Visa
  "visaType",
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
};

/**
 * Field → master `type` for ESS General Info dropdowns.
 * Frontend: GET /api/masters?type=<type>&status=Active
 */
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
    // nomineeName = free text input (not a master dropdown)
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
  GENERAL_INFO_DROPDOWNS,
  isCompanyType,
  getModel,
  toMasterDto,
  findMasterById,
  findMasterByIdLean,
  clearAllMasterCollections,
};
