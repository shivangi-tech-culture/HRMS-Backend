/**
 * Employee / User routes → /api/employees
 *
 * WHAT THIS FILE DOES:
 *   Connects HTTP URLs to controllers, with security + validation in between.
 *
 * MIDDLEWARE ORDER (left → right):
 *   1. protect     → must be logged in (JWT)
 *   2. authorize   → role must be allowed
 *   3. validate    → Joi checks the body
 *   4. controller  → business logic
 *
 * WHO CAN CALL WHAT:
 *   Create user          → Super Admin, HR Manager
 *   List / Get / Update  → Super Admin, HR Manager, Manager, Employee
 *   Delete               → Super Admin, HR Manager, Manager
 *
 * CREATE BODY:
 *   Required flat: name, officialEmail, password, role, company, department, status
 *   Optional flat: employeeCode, mobileNo, city, state, country
 *   Optional nested (same request): personal, official, other, education,
 *   accounts, family, nominees, experience, visas, payroll
 *
 * UPDATE:
 *   One PUT for all objects (personal, official, education, …).
 *   Employee cannot send official{} or payroll{}.
 */
const express = require("express");
const {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  uploadEducationDocument,
} = require("../controllers/employee.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { uploadEducationDoc } = require("../middleware/upload");
const {
  createUserSchema,
  updateUserSchema,
} = require("../validators/user.validation");

const router = express.Router();


/**
 * @swagger
 * tags:
 *   - name: Employees
 *     description: Create User + profile CRUD + education upload + detailsApproval
 */

/**
 * @swagger
 * /api/employees:
 *   post:
 *     tags: [Employees]
 *     summary: Create User
 *     description: |
 *       **Who:** Super Admin, HR Manager
 *
 *       **Required:** name, officialEmail, password, role, company, department, status
 *       **Optional flat:** employeeCode, mobileNo, city, state, country
 *       **Optional nested (same request):** personal, official, other, education,
 *       accounts, family, nominees, experience, visas, payroll
 *
 *       Flat fields fill official / personal when the nested object omits them.
 *       Top-level officialEmail is always the login id.
 *       detailsApproval = Approved (Super Admin only) | Unapproved (everyone else)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserBody'
 *           examples:
 *             employee:
 *               summary: Create Employee
 *               value:
 *                 name: Ananya Iyer
 *                 officialEmail: ananya@techculture.ai
 *                 employeeCode: EMP-1024
 *                 mobileNo: "9810044556"
 *                 password: "123456"
 *                 role: Employee
 *                 company: TechCulture Solutions Private Limited
 *                 department: Finance
 *                 city: Noida
 *                 state: DELHI
 *                 country: India
 *                 status: Active
 *             hrManager:
 *               summary: Create HR Manager
 *               value:
 *                 name: Priya Sharma
 *                 officialEmail: priya@techculture.ai
 *                 employeeCode: EMP-2001
 *                 mobileNo: "9876543210"
 *                 password: "123456"
 *                 role: HR Manager
 *                 company: TechCulture Solutions Private Limited
 *                 department: HR
 *                 city: Noida
 *                 state: DELHI
 *                 country: India
 *                 status: Active
 *             fullProfile:
 *               summary: Create with full profile
 *               value:
 *                 name: Ananya Iyer
 *                 officialEmail: ananya.full@techculture.ai
 *                 password: "123456"
 *                 role: Employee
 *                 company: TechCulture Solutions Private Limited
 *                 department: Finance
 *                 status: Active
 *                 personal:
 *                   dateOfBirth: "1996-04-12"
 *                   aadhaarNo: "123412341234"
 *                   panNo: ABCDE1234F
 *                   gender: Female
 *                   fatherOrHusbandName: Ramesh Iyer
 *                   maritalStatus: Single
 *                   personalEmail: ananya.personal@gmail.com
 *                   languageKnown: English, Hindi
 *                   emergencyContact1: "9810011122"
 *                   emergencyContact2: "9810033344"
 *                   drivingLicenseNo: DL-0420110012345
 *                   licenseValidUpto: "2030-04-12"
 *                   passportNo: J8765432
 *                   presentAddress:
 *                     address: Sector 62
 *                     country: India
 *                     state: DELHI
 *                     city: Noida
 *                     pincode: "201301"
 *                 official:
 *                   employeeCode: EMP-1024
 *                   designation: Finance Executive
 *                   dateOfJoining: "2024-01-15"
 *                   grade: G4
 *                 education:
 *                   - courseName: B.Com
 *                     courseLevel: Graduation
 *                     instituteName: ABC College
 *                 payroll:
 *                   basic: 40000
 *                   paymentMode: Bank
 *     responses:
 *       201: { description: User created (emailSent true/false) }
 *       400: { description: Validation failed / unique field conflict }
 *       403: { description: Role not allowed }
 */
// CREATE USER — Super Admin / HR Manager only
router.post(
  "/",
  protect,
  authorize("Super Admin", "HR Manager"),
  validate(createUserSchema),
  createEmployee
);

/**
 * @swagger
 * /api/employees:
 *   get:
 *     tags: [Employees]
 *     summary: List users
 *     description: |
 *       **Who:** Super Admin, HR Manager, Manager, Employee
 *       - Admin roles → all users
 *       - Employee → only self
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of employees with count
 */
// LIST USERS — admin: all | employee: self
router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  listEmployees
);

/**
 * @swagger
 * /api/employees/{id}/education/document:
 *   post:
 *     tags: [Employees]
 *     summary: Upload education document (certificate / marksheet)
 *     description: |
 *       Form-data field: `document` (file only).
 *       Uploads to Cloudinary and returns `document` URL + `documentName`.
 *       Does **not** update DB — frontend includes URL in education on Submit (PUT).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Certificate or marksheet (PDF, JPG, PNG, DOC — max 5MB)
 *     responses:
 *       201:
 *         description: Uploaded — returns document URL + documentName
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Document uploaded
 *               document: https://res.cloudinary.com/demo/image/upload/v1/hrms/education/marksheet.pdf
 *               documentName: marksheet.pdf
 *       400:
 *         description: No file or invalid type
 *       500:
 *         description: Cloudinary not configured or upload failed
 */
// UPLOAD education document — Cloudinary URL only (DB save via PUT education[])
router.post(
  "/:id/education/document",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  (req, res, next) => {
    uploadEducationDoc(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadEducationDocument
);

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     tags: [Employees]
 *     summary: Get one user
 *     description: |
 *       **Who:** Admin roles (any id) | Employee (own id only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Single employee profile
 *       403:
 *         description: Not own profile
 *       404:
 *         description: Not found
 */
// GET ONE USER by id
router.get(
  "/:id",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  getEmployee
);

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     tags: [Employees]
 *     summary: Update user / approve details / education
 *     description: |
 *       **Who:** Admin (any) | Own profile if detailsApproval ≠ Approved
 *       (Super Admin never locked; HR/Manager/Employee locked when Approved)
 *
 *       **Joi:** nested objects only — personal (addresses/emails/phones),
 *       official, other, education, etc. Flat city/company → 400. No contact module.
 *
 *       **Employee can update:** personal.mobileNo, personal.workPhone, personal.workExt
 *       (and other personal fields) while detailsApproval ≠ Approved
 *
 *       **Admin-only (official{}):** employeeCode, officialEmail, company, department, …
 *       Also: detailsApproval, password (Super Admin/HR), payroll, role, status
 *
 *       **Unique when non-empty:** officialEmail, employeeCode, mobileNo,
 *       personalEmail, panNo, aadhaarNo, drivingLicenseNo, passportNo → 400 if duplicate
 *
 *       **Auto:** personal.anniversaryDate = next work anniversary from official.dateOfJoining
 *
 *       **Education + document:** upload via POST .../education/document, then PUT education[] with
 *       `document` + `documentName`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserBody'
 *           examples:
 *             superAdminFull:
 *               summary: Super Admin — all objects (incl. official + payroll)
 *               value:
 *                 name: Ananya Iyer
 *                 detailsApproval: Approved
 *                 personal:
 *                   dateOfBirth: "1995-06-15"
 *                   gender: Female
 *                   maritalStatus: Single
 *                   fatherOrHusbandName: Ramesh Iyer
 *                   panNo: ABCDE1234F
 *                   aadhaarNo: "123456789012"
 *                   personalEmail: ananya.personal@gmail.com
 *                   mobileNo: "9810044556"
 *                   workPhone: "0120-4000000"
 *                   workExt: "204"
 *                   drivingLicenseNo: DL-0420110012345
 *                   passportNo: J8765432
 *                   languageKnown: Hindi, English
 *                   emergencyContact1: Neha - 9876543210
 *                   emergencyContact2: ""
 *                   presentAddress:
 *                     address: Sector 62
 *                     city: Noida
 *                     state: DELHI
 *                     country: India
 *                     pincode: "201301"
 *                   permanentAddress:
 *                     address: Sector 62
 *                     city: Noida
 *                     state: DELHI
 *                     country: India
 *                     pincode: "201301"
 *                 official:
 *                   employeeCode: EMP-1024
 *                   officialEmail: ananya@techculture.ai
 *                   company: TechCulture Solutions Private Limited
 *                   department: Finance
 *                   designation: Finance Executive
 *                   reportingHead1: Shivangi Gupta
 *                   jobRole: Executive
 *                   dateOfJoining: "2024-01-15"
 *                   grade: G4
 *                 other:
 *                   bloodGroup: B+
 *                   passportExpiry: "2030-12-31"
 *                 education:
 *                   - courseType: Full Time
 *                     courseLevel: Graduation
 *                     courseName: B.Tech
 *                     instituteName: ABC College
 *                     location: Noida
 *                     fromYear: "2016"
 *                     passingYear: "2020"
 *                     percentageOrGrade: 8.2 CGPA
 *                     document: https://res.cloudinary.com/demo/raw/upload/v1/hrms/education/marksheet.pdf
 *                     documentName: marksheet.pdf
 *                 accounts:
 *                   - bankName: HDFC Bank
 *                     accountNo: "50100123456789"
 *                     accountHolderName: Ananya Iyer
 *                     ifscCode: HDFC0001234
 *                     location: Noida
 *                     active: true
 *                     salaryAccount: true
 *                 family:
 *                   - name: Ramesh Iyer
 *                     relation: Father
 *                     occupation: Business
 *                     mobileNo: "9876501234"
 *                 nominees:
 *                   - nominateFor: PF
 *                     nomineeName: Neha Iyer
 *                     relation: Sister
 *                     amountPercent: 100
 *                 experience:
 *                   - organization: Previous Corp
 *                     designation: Analyst
 *                     location: Noida
 *                     fromDate: "2020-07-01"
 *                     toDate: "2023-12-31"
 *                     lastSalaryDrawn: "45000"
 *                 visas:
 *                   - countryName: USA
 *                     visaType: B1/B2
 *                     visaNumber: V1234567
 *                     fromDate: "2025-01-01"
 *                     toDate: "2025-12-31"
 *                 payroll:
 *                   basic: 40000
 *                   annualCtc: 600000
 *                   paymentMode: Bank
 *                   taxRegime: New
 *                   bankName: HDFC Bank
 *                   bankAccount: "50100123456789"
 *                   ifsc: HDFC0001234
 *             employeeSelf:
 *               summary: Employee — personal / other / arrays only (no official/payroll)
 *               value:
 *                 personal:
 *                   dateOfBirth: "1995-06-15"
 *                   gender: Female
 *                   maritalStatus: Single
 *                   fatherOrHusbandName: Ramesh Iyer
 *                   panNo: ABCDE1234F
 *                   aadhaarNo: "123456789012"
 *                   personalEmail: ananya.personal@gmail.com
 *                   mobileNo: "9810044556"
 *                   workPhone: "0120-4000000"
 *                   workExt: "204"
 *                   drivingLicenseNo: DL-0420110012345
 *                   passportNo: J8765432
 *                   languageKnown: Hindi, English
 *                   emergencyContact1: Neha - 9876543210
 *                   presentAddress:
 *                     address: Sector 62
 *                     city: Noida
 *                     state: DELHI
 *                     country: India
 *                     pincode: "201301"
 *                   permanentAddress:
 *                     address: Sector 62
 *                     city: Noida
 *                     state: DELHI
 *                     country: India
 *                     pincode: "201301"
 *                 other:
 *                   bloodGroup: B+
 *                   passportExpiry: "2030-12-31"
 *                 education:
 *                   - courseType: Full Time
 *                     courseLevel: Graduation
 *                     courseName: B.Tech
 *                     instituteName: ABC College
 *                     location: Noida
 *                     fromYear: "2016"
 *                     passingYear: "2020"
 *                     document: https://res.cloudinary.com/demo/raw/upload/v1/hrms/education/marksheet.pdf
 *                     documentName: marksheet.pdf
 *                 accounts:
 *                   - bankName: HDFC Bank
 *                     accountNo: "50100123456789"
 *                     accountHolderName: Ananya Iyer
 *                     ifscCode: HDFC0001234
 *                     active: true
 *                     salaryAccount: true
 *                 family:
 *                   - name: Ramesh Iyer
 *                     relation: Father
 *                     occupation: Business
 *                     mobileNo: "9876501234"
 *                 nominees:
 *                   - nominateFor: PF
 *                     nomineeName: Neha Iyer
 *                     relation: Sister
 *                     amountPercent: 100
 *                 experience:
 *                   - organization: Previous Corp
 *                     designation: Analyst
 *                     fromDate: "2020-07-01"
 *                     toDate: "2023-12-31"
 *                 visas:
 *                   - countryName: USA
 *                     visaType: B1/B2
 *                     visaNumber: V1234567
 *                     fromDate: "2025-01-01"
 *                     toDate: "2025-12-31"
 *             approve:
 *               summary: Approve details (admin)
 *               value: { detailsApproval: Approved }
 *             phonesOnly:
 *               summary: Employee update phones only
 *               value:
 *                 personal:
 *                   mobileNo: "9810044556"
 *                   workPhone: "0120-4000000"
 *                   workExt: "204"
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Unknown / invalid fields / unique conflict }
 *       403: { description: Locked after Approved / no permission }
 */
// UPDATE PROFILE — one API for all nested objects (admin vs employee rules in controller)
router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  validate(updateUserSchema),
  updateEmployee
);

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     tags: [Employees]
 *     summary: Delete user
 *     description: |
 *       **Who:** Super Admin, HR Manager, Manager
 *       Cannot delete your own account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Cannot delete self }
 *       404: { description: Not found }
 */
// DELETE USER — admin only; cannot delete yourself
router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  deleteEmployee
);

module.exports = router;
