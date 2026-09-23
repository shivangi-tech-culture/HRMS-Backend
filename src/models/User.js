/**
 * User / Employee model (MongoDB / Mongoose)
 *
 * WHAT THIS FILE IS:
 *   One document = one person in the HRMS (login account + full profile).
 *
 * LOGIN:
 *   User signs in with official.officialEmail + password.
 *   That email must be unique (empty values are ignored by the index).
 *
 * WHO CAN EDIT WHAT:
 *   personal{}  → employee can update (if detailsApproval is not Approved)
 *   official{}  → Super Admin / HR Manager / Manager only
 *   payroll{}   → admin only
 *
 * CREATE USER:
 *   Flat account fields plus optional nested profile in one POST.
 *   officialEmail  → official.officialEmail
 *   employeeCode   → official.employeeCode
 *   mobileNo       → personal.mobileNo
 *   company/dept   → official
 *   city/state/country → personal.permanentAddress
 *   personal / official / other / education / accounts / family /
 *   nominees / experience / visas / payroll → saved as sent
 *
 * UNIQUE WHEN NOT EMPTY:
 *   officialEmail, employeeCode, mobileNo, personalEmail,
 *   panNo, aadhaarNo, drivingLicenseNo, passportNo
 */
const mongoose = require("mongoose");
const { nextWorkAnniversary } = require("../utils/anniversary");

/**
 * Address block reused for present + permanent address.
 * _id: false → do not create a separate id for each address object.
 */
const addressSchema = new mongoose.Schema(
  {
    address: { type: String, default: "" }, // street / line 1
    country: { type: String, default: "" },
    state: { type: String, default: "" },
    city: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // =========================================================================
    // ACCOUNT — used for login and access control
    // =========================================================================
    name: { type: String, default: "", trim: true }, // display name
    password: { type: String, default: "" }, // always store hashed (bcrypt), never plain text
    role: {
      type: String,
      default: "Employee",
      trim: true,
    }, // Super Admin | HR Manager | Manager | Employee
    status: { type: String, default: "Active" }, // Active = can login | Inactive = blocked
    lastLogin: { type: Date, default: null }, // updated on every successful login

    /**
     * Profile review status (set by admin).
     * Unapproved / Rejected → employee may edit own profile
     * Approved              → employee own-profile edit is locked
     * Super Admin users start as Approved; others start as Unapproved
     */
    detailsApproval: {
      type: String,
      enum: ["Unapproved", "Approved", "Rejected"],
      default: "Unapproved",
    },

    // =========================================================================
    // 1. PERSONAL — employee can update (phones, emails, addresses, IDs)
    // =========================================================================
    personal: {
      dateOfBirth: { type: Date, default: null },
      aadhaarNo: { type: String, default: "" }, // unique when set
      panNo: { type: String, default: "" }, // unique when set
      gender: { type: String, default: "" },
      fatherOrHusbandName: { type: String, default: "" },
      maritalStatus: { type: String, default: "" },
      spouseName: { type: String, default: "" },
      // Filled automatically from official.dateOfJoining (do not trust client value)
      anniversaryDate: { type: Date, default: null },
      personalEmail: { type: String, default: "" }, // unique when set (not login id)
      languageKnown: { type: String, default: "" },
      emergencyContact1: { type: String, default: "" },
      emergencyContact2: { type: String, default: "" },
      drivingLicenseNo: { type: String, default: "" }, // unique when set
      licenseValidUpto: { type: Date, default: null },
      passportNo: { type: String, default: "" }, // unique when set
      remarks: { type: String, default: "" },
      presentAddress: { type: addressSchema, default: () => ({}) },
      permanentAddress: { type: addressSchema, default: () => ({}) },
      mobileNo: { type: String, default: "" }, // unique when set
      workPhone: { type: String, default: "" }, // not unique
      workExt: { type: String, default: "" }, // not unique
    },

    // =========================================================================
    // 2. OFFICIAL — admin only (employee cannot change these)
    // =========================================================================
    official: {
      employeeCode: { type: String, default: "" }, // unique when set (e.g. EMP-1024)
      officialEmail: {
        type: String,
        default: "",
        lowercase: true,
        trim: true,
      }, // LOGIN ID — unique when set
      company: { type: String, default: "" },
      department: { type: String, default: "" },
      designation: { type: String, default: "" },
      reportingHead1: { type: String, default: "" },
      reportingHead2: { type: String, default: "" },
      jobRole: { type: String, default: "" },
      dateOfJoining: { type: Date, default: null }, // also drives anniversaryDate
      calculateSalaryFrom: { type: Date, default: null },
      dateOfRetirement: { type: Date, default: null },
      grade: { type: String, default: "" },
    },

    // =========================================================================
    // 3. OTHER
    // =========================================================================
    other: {
      bloodGroup: { type: String, default: "" },
      passportExpiry: { type: Date, default: null },
    },

    // =========================================================================
    // 4. EDUCATION — list of courses (array)
    // =========================================================================
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
        document: { type: String, default: "" }, // Cloudinary file URL
        documentName: { type: String, default: "" }, // original file name
        remarks: { type: String, default: "" },
      },
    ],

    // =========================================================================
    // 5. BANK ACCOUNTS — list (array)
    // =========================================================================
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

    // =========================================================================
    // 6. FAMILY — list (array)
    // =========================================================================
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

    // =========================================================================
    // 7. NOMINEES — list (array)
    // =========================================================================
    nominees: [
      {
        nominateFor: { type: String, default: "" }, // e.g. PF, Gratuity
        nomineeName: { type: String, default: "" },
        relation: { type: String, default: "" },
        dob: { type: Date, default: null },
        amountPercent: { type: Number, default: 0 },
        address: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],

    // =========================================================================
    // 8. EXPERIENCE — previous jobs (array)
    // =========================================================================
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

    // =========================================================================
    // 9. VISAS — list (array)
    // =========================================================================
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

    // =========================================================================
    // PAYROLL — admin only (optional on Create User)
    // =========================================================================
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
  { timestamps: true } // adds createdAt + updatedAt automatically
);

/**
 * Before every save:
 * If date of joining exists, set personal.anniversaryDate to the next work anniversary.
 */
userSchema.pre("save", function (next) {
  if (this.official?.dateOfJoining) {
    this.personal = this.personal || {};
    this.personal.anniversaryDate = nextWorkAnniversary(this.official.dateOfJoining);
  }
  next();
});

/**
 * Helper: unique index that ignores empty strings.
 * Many users can have "" — but two users cannot share the same non-empty value.
 */
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

// Export model so controllers can use User.find / User.create / …
module.exports = mongoose.model("User", userSchema);
