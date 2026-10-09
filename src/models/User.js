/**
 * USER MODEL — login account + employee profile (one document per person)
 * Login: official.officialEmail + password. Validation → user.validation.js (Joi).
 * Unique when set: officialEmail, employeeCode, mobileNo, personalEmail, pan, aadhaar, DL, passport.
 */
const mongoose = require("mongoose");
const { nextWorkAnniversary } = require("../utils/anniversary");

/** Address block for present + permanent (_id: false) */
const addressSchema = new mongoose.Schema(
  {
    /** Street / line 1 */
    address: { type: String, default: "" },
    /** Country name */
    country: { type: String, default: "" },
    /** State / province */
    state: { type: String, default: "" },
    /** City */
    city: { type: String, default: "" },
    /** Postal / PIN code */
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // ACCOUNT — used for login and access control

    /** Display name shown in UI and emails */
    name: { type: String, default: "", trim: true },
    /** Always store bcrypt hash — never plain text */
    password: { type: String, default: "" },
    /**
     * Access role string (must match Role.name / authorize lists).
     * Hierarchy: Super Admin | Admin | HR Manager | Reporting Manager | Employee
     * (see src/config/roles.js)
     */
    role: {
      type: String,
      default: "Employee",
      trim: true,
    },
    /** Active = can login; Inactive = blocked by protect() */
    status: { type: String, default: "Active" },
    /** Updated on every successful login */
    lastLogin: { type: Date, default: null },
    /** Optional profile photo URL (Cloudinary / CDN) — My Profile avatar */
    avatar: { type: String, default: "" },

    // 1. PERSONAL — employee can update (phones, emails, addresses, IDs)

    personal: {
      /** Date of birth */
      dateOfBirth: { type: Date, default: null },
      /** Unique when set — Indian Aadhaar */
      aadhaarNo: { type: String, default: "" },
      /** Unique when set — PAN */
      panNo: { type: String, default: "" },
      gender: { type: String, default: "" },
      fatherOrHusbandName: { type: String, default: "" },
      maritalStatus: { type: String, default: "" },
      spouseName: { type: String, default: "" },
      /**
       * Next work-anniversary date (auto from official.dateOfJoining).
       * Do not trust a client-supplied value — pre-save hook overwrites it.
       */
      anniversaryDate: { type: Date, default: null },
      /** Unique when set — not used as login id */
      personalEmail: { type: String, default: "" },
      languageKnown: { type: String, default: "" },
      emergencyContact1: { type: String, default: "" },
      emergencyContact2: { type: String, default: "" },
      /** Unique when set */
      drivingLicenseNo: { type: String, default: "" },
      licenseValidUpto: { type: Date, default: null },
      /** Unique when set */
      passportNo: { type: String, default: "" },
      remarks: { type: String, default: "" },
      /** Current residential address */
      presentAddress: { type: addressSchema, default: () => ({}) },
      /** Permanent / native address */
      permanentAddress: { type: addressSchema, default: () => ({}) },
      /** Unique when set — primary mobile */
      mobileNo: { type: String, default: "" },
      /** Office phone (not unique) */
      workPhone: { type: String, default: "" },
      /** Office extension (not unique) */
      workExt: { type: String, default: "" },
    },
    // 2. OFFICIAL — admin only (employee cannot change these)

    official: {
      /** Unique when set (e.g. EMP-1024) */
      employeeCode: { type: String, default: "" },
      /**
       * LOGIN ID — unique when set.
       * Stored lowercase; used by auth + uniqueFields helpers.
       */
      officialEmail: {
        type: String,
        default: "",
        lowercase: true,
        trim: true,
      },
      /**
       * Company _ids (Employee / RM: one. HR: one or more).
       * Index 0 is this person's own workplace (branchId + shiftId sit on it).
       * Later ids are assigned to an HR Manager for access only:
       * every branch, shift and employee of that company. No extra flag on the id.
       */
      companyIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Company" }],
        default: undefined,
      },
      /** Branch master _id — must be one of the company's branches */
      branchId: { type: mongoose.Schema.Types.ObjectId, default: null },
      /** Shift master _id — must be on that branch. Days stay on Company. */
      shiftId: { type: mongoose.Schema.Types.ObjectId, default: null },
      /** Department name from masters (string, not ObjectId) */
      department: { type: String, default: "" },
      /** Designation name from masters */
      designation: { type: String, default: "" },
      /** Division name from masters */
      division: { type: String, default: "" },
      /** Employee group name from masters */
      employeeGroup: { type: String, default: "" },
      /** Primary reporting manager (User _id, role Reporting Manager). Assigned manually. */
      reportingHead1: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      /** Secondary reporting manager (User _id) */
      reportingHead2: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      jobRole: { type: String, default: "" },
      /** Joining date — also drives personal.anniversaryDate */
      dateOfJoining: { type: Date, default: null },
      /** Payroll start date (may differ from joining) */
      calculateSalaryFrom: { type: Date, default: null },
      dateOfRetirement: { type: Date, default: null },
      grade: { type: String, default: "" },
    },
    // 3. OTHER — extra personal details

    other: {
      bloodGroup: { type: String, default: "" },
      passportExpiry: { type: Date, default: null },
    },
    // 4. EDUCATION — list of courses (array)

    education: [
      {
        courseType: { type: String, default: "" },
        courseLevel: { type: String, default: "" },
        courseName: { type: String, default: "" },
        instituteName: { type: String, default: "" },
        location: { type: String, default: "" },
        fromYear: { type: String, default: "" },
        passingYear: { type: String, default: "" },
        major: { type: String, default: "" },
        minor: { type: String, default: "" },
        percentageOrGrade: { type: String, default: "" },
        /** Cloudinary URL from POST /api/employees/upload */
        document: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],
    // 5. BANK ACCOUNTS — list (array)

    accounts: [
      {
        bankName: { type: String, default: "" },
        accountNo: { type: String, default: "" },
        accountHolderName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        location: { type: String, default: "" },
        remarks: { type: String, default: "" },
        /** Optional bank proof file URL (Cloudinary) */
        attachment: { type: String, default: "" },
        /** Soft-active flag for the account row */
        active: { type: Boolean, default: true },
        /** True when this account receives salary */
        salaryAccount: { type: Boolean, default: false },
      },
    ],
    // 6. FAMILY — list (array)

    family: [
      {
        name: { type: String, default: "" },
        relation: { type: String, default: "" },
        dob: { type: Date, default: null },
        occupation: { type: String, default: "" },
        education: { type: String, default: "" },
        aadhaarNo: { type: String, default: "" },
        mobileNo: { type: String, default: "" },
        /** Covered under company mediclaim? */
        mediclaim: { type: Boolean, default: false },
      },
    ],
    // 7. NOMINEES — list (array)

    nominees: [
      {
        /** Benefit type from master type=nominateFor (e.g. PF, Gratuity) */
        nominateFor: { type: String, default: "" },
        /** Free text — not a master dropdown */
        nomineeName: { type: String, default: "" },
        /** Relation from master type=relation */
        relation: { type: String, default: "" },
        dob: { type: Date, default: null },
        /** Share of benefit (0–100) */
        amountPercent: { type: Number, default: 0 },
        address: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],
    // 8. EXPERIENCE — previous jobs (array)

    experience: [
      {
        organization: { type: String, default: "" },
        designation: { type: String, default: "" },
        location: { type: String, default: "" },
        fromDate: { type: Date, default: null },
        toDate: { type: Date, default: null },
        lastSalaryDrawn: { type: String, default: "" },
        description: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],
    // 9. VISAS — list (array)

    visas: [
      {
        countryName: { type: String, default: "" },
        visaType: { type: String, default: "" },
        visaNumber: { type: String, default: "" },
        fromDate: { type: Date, default: null },
        toDate: { type: Date, default: null },
        remarks: { type: String, default: "" },
      },
    ],
    // PAYROLL — admin only (optional on Create User)

    payroll: {
      salaryGroup: { type: String, default: "" },
      salaryDate: { type: String, default: "" },
      appraisalDuration: { type: String, default: "" },
      basic: { type: Number, default: 0 },
      annualCtc: { type: Number, default: 0 },
      grossSalary: { type: Number, default: 0 },
      totalEarning: { type: Number, default: 0 },
      totalDeduction: { type: Number, default: 0 },
      appraisalDate: { type: Date, default: null },
      paymentMode: { type: String, default: "" },
      ot1Rate: { type: Number, default: 0 },
      ot2Rate: { type: Number, default: 0 },
      remarks: { type: String, default: "" },
      /** Universal Account Number (EPFO) */
      uanNo: { type: String, default: "" },
      pfApply: { type: Boolean, default: false },
      pfEmployerShare: { type: Boolean, default: false },
      pfNo: { type: String, default: "" },
      pfType: { type: String, default: "" },
      pf: { type: String, default: "" },
      pfApplyFrom: { type: Date, default: null },
      pfApplyTo: { type: Date, default: null },
      esiApply: { type: Boolean, default: false },
      esiNo: { type: String, default: "" },
      esiEmployerShare: { type: Boolean, default: false },
      esiApplyFrom: { type: Date, default: null },
      esiApplyTo: { type: Date, default: null },
      ptApply: { type: Boolean, default: false },
      tdsApply: { type: Boolean, default: false },
      taxRegime: { type: String, default: "New" },
      bankName: { type: String, default: "" },
      bankAccount: { type: String, default: "" },
      ifsc: { type: String, default: "" },
    },

    /**
     * This year's leave counters. Name, code, paid and max days stay on LeaveType
     * and are read by leaveType id. available and remaining update on apply.
     */
    leaves: [
      {
        leaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },
        year: { type: Number, required: true },
        adjusted: { type: Number, default: 0 },
        used: { type: Number, default: 0 },
        pending: { type: Number, default: 0 },
        available: { type: Number, default: 0 },
        remaining: { type: Number, default: 0 },
      },
    ],
    /** Comp Off and other extra-day notes for this employee. */
    leaveAdjustments: [
      {
        leaveType: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType" },
        year: { type: Number, default: 0 },
        days: { type: Number, required: true },
        reason: { type: String, default: "" },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true } // adds createdAt + updatedAt automatically
);

/** Before save: set personal.anniversaryDate from dateOfJoining */
userSchema.pre("save", function (next) {
  if (this.official?.dateOfJoining) {
    this.personal = this.personal || {};
    this.personal.anniversaryDate = nextWorkAnniversary(this.official.dateOfJoining);
  }
  next();
});

/** Unique index that ignores empty strings */
const uniquePartial = (path) => [
  { [path]: 1 },
  {
    unique: true,
    partialFilterExpression: { [path]: { $type: "string", $gt: "" } },
  },
];

// Login email must be unique
userSchema.index(...uniquePartial("official.officialEmail"));
// Other unique identity fields
userSchema.index(...uniquePartial("official.employeeCode"));
userSchema.index(...uniquePartial("personal.mobileNo"));
userSchema.index(...uniquePartial("personal.personalEmail"));
userSchema.index(...uniquePartial("personal.panNo"));
userSchema.index(...uniquePartial("personal.aadhaarNo"));
userSchema.index(...uniquePartial("personal.drivingLicenseNo"));
userSchema.index(...uniquePartial("personal.passportNo"));
userSchema.index({ "official.companyIds": 1 });
userSchema.index({ "official.branchId": 1 });
userSchema.index({ "official.shiftId": 1 });
userSchema.index({ role: 1, status: 1, name: 1 });
userSchema.index({ role: 1, status: 1, "official.companyIds": 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ "leaves.year": 1, "leaves.leaveType": 1 });
userSchema.index({ "official.reportingHead1": 1 });
userSchema.index({ "official.reportingHead2": 1 });

/** Mongoose model: User — used by auth, employees, attendance, seed, etc. */
module.exports = mongoose.model("User", userSchema);
