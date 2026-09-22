/**
 * User / employee request validation (Joi)
 *
 * Create: flat fields mapped into personal / official (mobileNo → personal.mobileNo)
 * Update: nested objects only — no contact module, no flat city/company
 */
const Joi = require("joi");

const str = () => Joi.string().allow("").optional();
const num = () => Joi.number().optional();
const bool = () => Joi.boolean().optional();
const date = () => Joi.date().allow(null).optional();

const only = (keys) => Joi.object(keys).unknown(false);

const address = only({
  address: str(),
  country: str(),
  state: str(),
  city: str(),
  pincode: str(),
});

const personal = only({
  employeeCode: str(),
  dateOfBirth: date(),
  aadhaarNo: str(),
  panNo: str(),
  gender: str(),
  fatherOrHusbandName: str(),
  maritalStatus: str(),
  spouseName: str(),
  anniversaryDate: date(),
  personalEmail: Joi.string().trim().email().allow("").optional(),
  officialEmail: Joi.string().trim().email().allow("").optional(),
  languageKnown: str(),
  emergencyContact1: str(),
  emergencyContact2: str(),
  drivingLicenseNo: str(),
  licenseValidUpto: date(),
  passportNo: str(),
  remarks: str(),
  presentAddress: address.optional(),
  permanentAddress: address.optional(),
  mobileNo: str(),
  workPhone: str(),
  workExt: str(),
});

const official = only({
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

const other = only({
  bloodGroup: str(),
  passportExpiry: date(),
});

const educationItem = only({
  _id: str(),
  courseType: str(),
  courseLevel: str(),
  courseName: str(),
  instituteName: str(),
  location: str(),
  fromYear: str(),
  passingYear: str(),
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
  ifscCode: str(),
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
  aadhaarNo: str(),
  mobileNo: str(),
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

const payroll = only({
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
  taxRegime: str(),
  bankName: str(),
  bankAccount: str(),
  ifsc: str(),
});

// CREATE USER — city/state/country optional; mobileNo → personal.mobileNo
const createUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  officialEmail: Joi.string().trim().email().required(),
  mobileNo: Joi.string().trim().min(8).max(20).optional(),
  password: Joi.string().min(6).max(50).required(),
  role: Joi.string().trim().required(),
  company: Joi.string().trim().min(2).required(),
  department: Joi.string().trim().min(2).required(),
  status: Joi.string().valid("Active", "Inactive").required(),
  city: Joi.string().trim().allow("").optional(),
  state: Joi.string().trim().allow("").optional(),
  country: Joi.string().trim().allow("").optional(),
}).unknown(false);

// UPDATE — only nested objects for profile fields (no flat city/company…)
const updateUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  password: Joi.string().min(6).max(50).optional(),
  role: Joi.string().trim().optional(),
  status: Joi.string().valid("Active", "Inactive").optional(),
  detailsApproval: Joi.string()
    .valid("Unapproved", "Approved", "Rejected")
    .optional(),
  personal: personal.optional(),
  official: official.optional(),
  other: other.optional(),
  education: Joi.array().items(educationItem).optional(),
  accounts: Joi.array().items(accountItem).optional(),
  family: Joi.array().items(familyItem).optional(),
  nominees: Joi.array().items(nomineeItem).optional(),
  experience: Joi.array().items(experienceItem).optional(),
  visas: Joi.array().items(visaItem).optional(),
  payroll: payroll.optional(),
})
  .min(1)
  .unknown(false);

const loginSchema = Joi.object({
  officialEmail: Joi.string().trim().email().required(),
  password: Joi.string().required(),
}).unknown(false);

module.exports = {
  createUserSchema,
  updateUserSchema,
  loginSchema,
};
