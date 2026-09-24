/**
 * User / employee request validation (Joi)
 *
 * WHY THIS FILE:
 *   Rejects unknown fields and wrong types before the controller runs.
 *   unknown(false) → extra keys in the body return HTTP 400.
 *
 * CREATE (same shape as User model — one format):
 *   Account flat: name, password, role, status
 *   Required nested: official{ officialEmail, company, department, … }
 *   Optional nested: personal{ mobileNo, … }, other{}, education[],
 *     accounts[], family[], nominees[], experience[], visas[], payroll{}
 *   No flat mobileNo / email / city — those live inside personal / official.
 *
 * UPDATE (nested objects only):
 *   personal{}, official{}, other{}, education[], accounts[], family[],
 *   nominees[], experience[], visas[], payroll{}
 */
const Joi = require("joi");
const { validate } = require("../middleware/validate");

// Small helpers so schemas stay short and consistent
const str = () => Joi.string().trim().allow("").optional();
const num = () => Joi.number().optional();
const bool = () => Joi.boolean().optional();
const date = () => Joi.date().allow(null).optional();
const emailOpt = () => Joi.string().trim().email().allow("").optional();
const phoneOpt = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{10}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a 10-digit phone number" });
const yearOpt = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{4}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a 4-digit year (e.g. 2020)" });
const ifscOpt = () =>
  Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a valid IFSC (e.g. HDFC0001234)" });

/** Object that only allows the listed keys (no extra junk) */
const only = (keys) => Joi.object(keys).unknown(false);

/** Address shape used inside personal.presentAddress / permanentAddress */
const address = only({
  address: str(),
  country: str(),
  state: str(),
  city: str(),
  pincode: str(),
});

/** personal{} fields — same keys as User.personal (like educationItem) */
const personalItem = only({
  dateOfBirth: date(),
  aadhaarNo: Joi.string().trim().pattern(/^\d{12}$/).allow("").optional(),
  panNo: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .allow("")
    .optional(),
  gender: str(),
  fatherOrHusbandName: str(),
  maritalStatus: str(),
  spouseName: str(),
  anniversaryDate: date(), // ignored in controller (auto-calculated)
  personalEmail: emailOpt(),
  languageKnown: str(),
  emergencyContact1: str(),
  emergencyContact2: str(),
  drivingLicenseNo: str(),
  licenseValidUpto: date(),
  passportNo: str(),
  remarks: str(),
  presentAddress: address.optional(),
  permanentAddress: address.optional(),
  mobileNo: phoneOpt(),
  workPhone: str(),
  workExt: str(),
});

/** official{} fields — same keys as User.official (like educationItem) */
const officialItem = only({
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  officialEmail: emailOpt(),
  company: str(),
  department: str(),
  designation: str(),
  reportingHead1: str(),
  reportingHead2: str(),
  jobRole: str(),
  dateOfJoining: date(),
  calculateSalaryFrom: date(),
  dateOfRetirement: date(),
  grade: str(),
});

/** other{} fields — same keys as User.other (like educationItem) */
const otherItem = only({
  bloodGroup: str(),
  passportExpiry: date(),
});

/** education[] row — unknown keys → 400 */
const educationItem = only({
  _id: str(),
  courseType: str(),
  courseLevel: str(),
  courseName: str(),
  instituteName: str(),
  location: str(),
  fromYear: yearOpt(),
  passingYear: yearOpt(),
  major: str(),
  minor: str(),
  percentageOrGrade: str(),
  document: str(),
  documentName: str(),
  remarks: str(),
});

const accountItem = only({
  _id: str(),
  bankName: str(),
  accountNo: str(),
  accountHolderName: str(),
  ifscCode: ifscOpt(),
  location: str(),
  remarks: str(),
  attachment: str(),
  active: bool(),
  salaryAccount: bool(),
});

const familyItem = only({
  _id: str(),
  name: str(),
  relation: str(),
  dob: date(),
  occupation: str(),
  education: str(),
  aadhaarNo: Joi.string().trim().pattern(/^\d{12}$/).allow("").optional(),
  mobileNo: phoneOpt(),
  mediclaim: bool(),
});

const nomineeItem = only({
  _id: str(),
  nominateFor: str(),
  nomineeName: str(),
  relation: str(),
  dob: date(),
  amountPercent: num(),
  address: str(),
  remarks: str(),
});

const experienceItem = only({
  _id: str(),
  organization: str(),
  designation: str(),
  location: str(),
  fromDate: date(),
  toDate: date(),
  lastSalaryDrawn: str(),
  description: str(),
  remarks: str(),
});

const visaItem = only({
  _id: str(),
  countryName: str(),
  visaType: str(),
  visaNumber: str(),
  fromDate: date(),
  toDate: date(),
  remarks: str(),
});

/** payroll{} fields — same keys as User.payroll (like educationItem) */
const payrollItem = only({
  salaryGroup: str(),
  salaryDate: str(),
  appraisalDuration: str(),
  basic: num(),
  annualCtc: num(),
  grossSalary: num(),
  totalEarning: num(),
  totalDeduction: num(),
  appraisalDate: date(),
  paymentMode: str(),
  ot1Rate: num(),
  ot2Rate: num(),
  remarks: str(),
  uanNo: str(),
  pfApply: bool(),
  pfEmployerShare: bool(),
  pfNo: str(),
  pfType: str(),
  pf: str(),
  pfApplyFrom: date(),
  pfApplyTo: date(),
  esiApply: bool(),
  esiNo: str(),
  esiEmployerShare: bool(),
  esiApplyFrom: date(),
  esiApplyTo: date(),
  ptApply: bool(),
  tdsApply: bool(),
  taxRegime: Joi.string().valid("New", "Old", "").optional(),
  bankName: str(),
  bankAccount: str(),
  ifsc: ifscOpt(),
});

/** Create: official must have login email + company + department */
const officialCreate = officialItem.keys({
  officialEmail: Joi.string().trim().email().required(),
  company: Joi.string().trim().min(2).required(),
  department: Joi.string().trim().min(2).required(),
});

/**
 * CREATE USER body — same shape as User model
 * Every nested object uses *Item schema (same as education → educationItem)
 */
const createUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  password: Joi.string().min(6).max(50).required(),
  role: Joi.string().trim().required(),
  status: Joi.string().valid("Active", "Inactive").required(),
  official: officialCreate.required(),
  personal: personalItem.optional(),
  other: otherItem.optional(),
  education: Joi.array().items(educationItem).optional(),
  accounts: Joi.array().items(accountItem).optional(),
  family: Joi.array().items(familyItem).optional(),
  nominees: Joi.array().items(nomineeItem).optional(),
  experience: Joi.array().items(experienceItem).optional(),
  visas: Joi.array().items(visaItem).optional(),
  payroll: payrollItem.optional(),
}).unknown(false);

/** One new/edited row, or the full list (replace). */
const listOrOne = (item) =>
  Joi.alternatives().try(item, Joi.array().items(item));

/**
 * UPDATE USER body
 * At least one field required. Same *Item field checks as create.
 * education, accounts, family, nominees, experience, visas:
 *   one object → append, or update that row when _id is sent
 *   array → replace the whole list
 */
const updateUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  password: Joi.string().min(6).max(50).optional(),
  role: Joi.string().trim().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  detailsApproval: Joi.string()
    .valid("Unapproved", "Approved", "Rejected")
    .optional(),
  personal: personalItem.optional(),
  official: officialItem.optional(),
  other: otherItem.optional(),
  education: listOrOne(educationItem).optional(),
  accounts: listOrOne(accountItem).optional(),
  family: listOrOne(familyItem).optional(),
  nominees: listOrOne(nomineeItem).optional(),
  experience: listOrOne(experienceItem).optional(),
  visas: listOrOne(visaItem).optional(),
  payroll: payrollItem.optional(),
})
  .min(1)
  .unknown(false);

/** LOGIN body */
const loginSchema = Joi.object({
  officialEmail: Joi.string().trim().email().required(),
  password: Joi.string().required(),
}).unknown(false);

/** Same row checks as update, keyed by the list name in the URL. */
const ARRAY_ITEM_SCHEMAS = {
  education: educationItem,
  accounts: accountItem,
  family: familyItem,
  nominees: nomineeItem,
  experience: experienceItem,
  visas: visaItem,
};

/** official{} and payroll{} — same field checks as profile update. Admin only. */
const OBJECT_SECTION_SCHEMAS = {
  official: officialItem,
  payroll: payrollItem,
};

const badSection = (res) =>
  res.status(400).json({
    message:
      "section must be education, accounts, family, nominees, experience, visas, official, or payroll",
  });

/** PUT /api/employees/:id/:section — official/payroll object, or one list row, or many rows. */
const validateSectionEdit = (req, res, next) => {
  const { section } = req.params;
  const objectSchema = OBJECT_SECTION_SCHEMAS[section];
  if (objectSchema) return validate(objectSchema.min(1))(req, res, next);

  const itemSchema = ARRAY_ITEM_SCHEMAS[section];
  if (!itemSchema) return badSection(res);

  const row = itemSchema.keys({ _id: Joi.string().trim().required() });
  return validate(Joi.alternatives().try(row, Joi.array().items(row).min(1)))(
    req,
    res,
    next
  );
};

/** DELETE /api/employees/:id/:section — one { _id }, an array of ids, or payroll clear. */
const validateSectionDelete = (req, res, next) => {
  const { section } = req.params;
  if (section === "official" || section === "payroll") return next();
  if (!ARRAY_ITEM_SCHEMAS[section]) return badSection(res);

  const id = Joi.string().trim().required();
  const one = Joi.object({ _id: id }).unknown(true);
  return validate(
    Joi.alternatives().try(
      one,
      Joi.array().items(id).min(1),
      Joi.array().items(one).min(1)
    )
  )(req, res, next);
};

module.exports = {
  createUserSchema,
  updateUserSchema,
  loginSchema,
  validateSectionEdit,
  validateSectionDelete,
  ARRAY_ITEM_SCHEMAS,
};
