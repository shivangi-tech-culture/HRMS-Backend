/**
 * User / Employee model
 *
 * Login ID = personal.officialEmail (unique).
 * No contact module — addresses + phones are under personal.
 * Emails only in personal (not duplicated elsewhere).
 *
 * Create User mapping:
 *   officialEmail → personal.officialEmail
 *   mobileNo      → personal.mobileNo (optional on create)
 *   company/department → official
 *   city/state/country → personal.permanentAddress
 */
const mongoose = require("mongoose");
const { nextWorkAnniversary } = require("../utils/anniversary");

/** Shared address shape (present + permanent) */
const addressSchema = new mongoose.Schema(
  {
    address: { type: String, default: "" },
    country: { type: String, default: "" },
    state: { type: String, default: "" },
    city: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // -------------------------------------------------------------------------
    // ACCOUNT (login)
    // -------------------------------------------------------------------------
    name: { type: String, default: "", trim: true },
    password: { type: String, default: "" }, // hashed
    role: { type: String, default: "Employee", trim: true }, // Super Admin | HR Manager | Manager | Employee
    status: { type: String, default: "Active" }, // Active | Inactive
    lastLogin: { type: Date, default: null }, // set on successful login

    // Profile review — Super Admin / HR Manager / Manager set this
    // Unapproved → employee can edit | Approved → employee edit locked | Rejected
    // Super Admin → Approved by default | HR / Manager / Employee → Unapproved
    detailsApproval: {
      type: String,
      enum: ["Unapproved", "Approved", "Rejected"],
      default: "Unapproved",
    },

    // -------------------------------------------------------------------------
    // 1. PERSONAL DETAILS (emails + addresses + phones)
    // -------------------------------------------------------------------------
    personal: {
      employeeCode: { type: String, default: "" }, // admin only
      dateOfBirth: { type: Date, default: null },
      aadhaarNo: { type: String, default: "" },
      panNo: { type: String, default: "" },
      gender: { type: String, default: "" },
      fatherOrHusbandName: { type: String, default: "" },
      maritalStatus: { type: String, default: "" },
      spouseName: { type: String, default: "" },
      anniversaryDate: { type: Date, default: null }, // auto from dateOfJoining
      personalEmail: { type: String, default: "" },
      officialEmail: { type: String, default: "", lowercase: true, trim: true },
      languageKnown: { type: String, default: "" },
      emergencyContact1: { type: String, default: "" },
      emergencyContact2: { type: String, default: "" },
      drivingLicenseNo: { type: String, default: "" },
      licenseValidUpto: { type: Date, default: null },
      passportNo: { type: String, default: "" },
      remarks: { type: String, default: "" },
      // Addresses
      presentAddress: { type: addressSchema, default: () => ({}) },
      permanentAddress: { type: addressSchema, default: () => ({}) },
      // Phones (Personal Details UI)
      mobileNo: { type: String, default: "" },
      workPhone: { type: String, default: "" },
      workExt: { type: String, default: "" },
    },

    // -------------------------------------------------------------------------
    // 2. OFFICIAL DETAILS — admin only (employee cannot update)
    // -------------------------------------------------------------------------
    official: {
      company: { type: String, default: "" },
      department: { type: String, default: "" },
      designation: { type: String, default: "" },
      reportingHead1: { type: String, default: "" },
      reportingHead2: { type: String, default: "" },
      jobRole: { type: String, default: "" },
      dateOfJoining: { type: Date, default: null },
      calculateSalaryFrom: { type: Date, default: null },
      dateOfRetirement: { type: Date, default: null },
      grade: { type: String, default: "" },
    },

    // -------------------------------------------------------------------------
    // 3. OTHER DETAILS
    // -------------------------------------------------------------------------
    other: {
      bloodGroup: { type: String, default: "" },
      passportExpiry: { type: Date, default: null },
    },

    // -------------------------------------------------------------------------
    // 4. EDUCATION (array)
    // -------------------------------------------------------------------------
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
        // Upload Document — Cloudinary URL (PDF, JPG, PNG, DOC)
        document: { type: String, default: "" },
        documentName: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],

    // -------------------------------------------------------------------------
    // 5. BANK ACCOUNTS (array)
    // -------------------------------------------------------------------------
    accounts: [
      {
        bankName: { type: String, default: "" },
        accountNo: { type: String, default: "" },
        accountHolderName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        location: { type: String, default: "" },
        remarks: { type: String, default: "" },
        attachment: { type: String, default: "" },
        active: { type: Boolean, default: true },
        salaryAccount: { type: Boolean, default: false },
      },
    ],

    // -------------------------------------------------------------------------
    // 6. FAMILY (array)
    // -------------------------------------------------------------------------
    family: [
      {
        name: { type: String, default: "" },
        relation: { type: String, default: "" },
        dob: { type: Date, default: null },
        occupation: { type: String, default: "" },
        education: { type: String, default: "" },
        aadhaarNo: { type: String, default: "" },
        mobileNo: { type: String, default: "" },
        mediclaim: { type: Boolean, default: false },
      },
    ],

    // -------------------------------------------------------------------------
    // 7. NOMINEES (array)
    // -------------------------------------------------------------------------
    nominees: [
      {
        nominateFor: { type: String, default: "" },
        nomineeName: { type: String, default: "" },
        relation: { type: String, default: "" },
        dob: { type: Date, default: null },
        amountPercent: { type: Number, default: 0 },
        address: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],

    // -------------------------------------------------------------------------
    // 8. EXPERIENCE / JOB HISTORY (array)
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 9. VISAS (array)
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // PAYROLL — admin update only (not set on Create User)
    // -------------------------------------------------------------------------
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
  },
  { timestamps: true }
);

// Before save: refresh work anniversary from date of joining
userSchema.pre("save", function (next) {
  if (this.official?.dateOfJoining) {
    this.personal = this.personal || {};
    this.personal.anniversaryDate = nextWorkAnniversary(this.official.dateOfJoining);
  }
  next();
});

// Login ID — unique official email (ignore empty values)
userSchema.index(
  { "personal.officialEmail": 1 },
  {
    unique: true,
    partialFilterExpression: { "personal.officialEmail": { $type: "string", $gt: "" } },
  }
);

module.exports = mongoose.model("User", userSchema);
