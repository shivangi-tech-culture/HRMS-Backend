/**
 * EMPLOYEE MANAGEMENT VALIDATION (Joi) — /api/employees
 * Login · create Employee · update profile · delete section.
 * Access & Control lean users → accessControl.validation.js
 */
const Joi = require("joi");
const { validate } = require("../middleware/validate");

// Small helpers

const str = () => Joi.string().trim().allow("").optional();
const num = () => Joi.number().optional();
const bool = () => Joi.boolean().optional();
const date = () => Joi.date().allow(null).optional();
const emailOpt = () => Joi.string().trim().email().allow("").optional();
/** 10-digit Indian-style mobile (digits only) */
const phoneOpt = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{10}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a 10-digit phone number" });
/** Four-digit year string, e.g. "2020" */
const yearOpt = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{4}$/)
    .allow("")
    .optional()
    .messages({ "string.pattern.base": "must be a 4-digit year (e.g. 2020)" });
/** IFSC code, e.g. HDFC0001234 */
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

/**
 * Address block — used inside personal.presentAddress / permanentAddress
 * Fields: address, country, state, city, pincode
 */
const address = only({
  address: str(),
  country: str(),
  state: str(),
  city: str(),
  pincode: str(),
});

/**
 * personal{} — identity, contacts, addresses (same keys as User.personal)
 * anniversaryDate is ignored by the controller (auto-calculated from joining date)
 */
const personalItem = only({
  dateOfBirth: date(),
  /** 12-digit Aadhaar when provided */
  aadhaarNo: Joi.string().trim().pattern(/^\d{12}$/).allow("").optional(),
  /** PAN format: five letters, four digits, one letter */
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

/**
 * official{} — work email, company, department, reporting heads, etc.
 * Login email is official.officialEmail
 */
const officialItem = only({
  employeeCode: Joi.string().trim().uppercase().allow("").optional(),
  officialEmail: emailOpt(),
  company: str(),
  department: str(),
  designation: str(),
  division: str(),
  employeeGroup: str(),
  reportingHead1: str(),
  reportingHead2: str(),
  jobRole: str(),
  dateOfJoining: date(),
  calculateSalaryFrom: date(),
  dateOfRetirement: date(),
  grade: str(),
  /** Master Shift _id — HR / Super Admin / Global Admin only */
  shift: Joi.string().hex().length(24).allow(null, "").optional(),
});

/** other{} — blood group and passport expiry */
const otherItem = only({
  bloodGroup: str(),
  passportExpiry: date(),
});

/**
 * education[] row — course details + optional Cloudinary document URL
 * Include _id when editing an existing row on update
 */
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
  document: str(), // Cloudinary URL only
  remarks: str(),
});

/** accounts[] row — bank account; attachment = Cloudinary URL from upload */
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

/** family[] row — dependents / relatives */
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

/** nominees[] row — PF / insurance; nomineeName = free text (not master) */
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

/** experience[] row — previous employment */
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

/** visas[] row — travel / work visas */
const visaItem = only({
  _id: str(),
  countryName: str(),
  visaType: str(),
  visaNumber: str(),
  fromDate: date(),
  toDate: date(),
  remarks: str(),
});

/**
 * payroll{} — salary, PF/ESI, tax regime, bank for pay
 * Admin-only on update (Employee cannot send this object)
 */
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

// Official variants for CREATE (by role)

/**
 * CREATE EMPLOYEE — POST /api/employees (Employee Management)
 * Essential: name, password, status, officialEmail, employeeCode, dateOfBirth
 * Optional: department, designation, address (country/state/city), rest of profile
 */
const createEmployeeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  password: Joi.string().min(6).max(50).required(),
  role: Joi.string().valid("Employee").default("Employee"),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  official: officialItem
    .keys({
      officialEmail: Joi.string().trim().email().required(),
      employeeCode: Joi.string().trim().uppercase().min(2).required(),
      company: Joi.string().trim().min(2).required(),
      department: Joi.string().trim().allow("").optional(),
    })
    .required(),
  personal: personalItem
    .keys({
      dateOfBirth: Joi.date().required(),
    })
    .required(),
  other: otherItem.optional(),
  education: Joi.array().items(educationItem).optional(),
  accounts: Joi.array().items(accountItem).optional(),
  family: Joi.array().items(familyItem).optional(),
  nominees: Joi.array().items(nomineeItem).optional(),
  experience: Joi.array().items(experienceItem).optional(),
  visas: Joi.array().items(visaItem).optional(),
  payroll: payrollItem.optional(),
}).unknown(false);

/** One new/edited row, or the full list (replace). Used on update for array sections. */
const listOrOne = (item) =>
  Joi.alternatives().try(item, Joi.array().items(item));

/**
 * UPDATE EMPLOYEE / profile — PUT /api/employees/:id
 * official.officialEmail and official.company are immutable (forbidden here).
 */
const officialUpdateItem = officialItem.fork(
  ["officialEmail", "company"],
  (schema) => schema.forbidden()
);

const updateUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  password: Joi.string().min(6).max(50).optional(),
  role: Joi.string().trim().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  personal: personalItem.optional(),
  official: officialUpdateItem.optional(),
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

/**
 * LOGIN body — POST /api/auth/login
 * Example: { "officialEmail": "hr@techculture.ai", "password": "123456" }
 */
const loginSchema = Joi.object({
  officialEmail: Joi.string().trim().email().required(),
  password: Joi.string().required(),
}).unknown(false);

/** Same row checks as update, keyed by the list name in the URL path */
const ARRAY_ITEM_SCHEMAS = {
  education: educationItem,
  accounts: accountItem,
  family: familyItem,
  nominees: nomineeItem,
  experience: experienceItem,
  visas: visaItem,
};

const badSection = (res) =>
  res.status(400).json({
    message:
      "section must be education, accounts, family, nominees, experience, visas, or payroll",
  });

/**
 * DELETE /api/employees/:id/:section middleware
 * Body: { _id }, or an array of ids / { _id } objects.
 * payroll and official skip body checks here (controller handles clear / reject).
 */
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
  createEmployeeSchema,
  updateUserSchema,
  loginSchema,
  validateSectionDelete,
  ARRAY_ITEM_SCHEMAS,
};
