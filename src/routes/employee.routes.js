/**
 * EMPLOYEE ROUTES — /api/employees
 * Employee Management (role = Employee only, full HR profile).
 * Access & Control (any role, lean login) → /api/users.
 */
const express = require("express");
const {
  createEmployee,
  listEmployees,
  exportEmployees,
  getEmployee,
  updateEmployee,
  listActivity,
  deleteSection,
  deleteEmployee,
  uploadAttachment,
} = require("../controllers/employee.controller");
const { protect, authorize, ALL_ACCESS, hasAllAccess } = require("../middleware/auth");
const {
  checkPermission,
  checkEmployeeProfilePermission,
} = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const { uploadFile } = require("../middleware/upload");
const {
  createEmployeeSchema,
  updateUserSchema,
  validateSectionDelete,
} = require("../validators/user.validation");
const { assignReportingManager } = require("../controllers/reportingManager.controller");
const { assignManagerSchema } = require("../validators/reportingManager.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Employees
 *     description: Create User + profile CRUD + education upload + activity log
 */

/**
 * @swagger
 * /api/employees:
 *   post:
 *     tags: [Admin / Employees]
 *     summary: Create Employee (Employee Management)
 *     description: |
 *       **Employee Management only** — always creates `role: Employee`.
 *       Access & Control (any login role) → `POST /api/users`.
 *
 *       **Who can CREATE:** Global Admin, Super Admin, HR Manager
 *       (Employee → Employee → create). **Employee role cannot create** —
 *       after create, Employee only **edits** own General Info.
 *
 *       Essential: name, password, officialEmail, employeeCode, dateOfBirth.
 *       Welcome email sent after create.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, password, official, personal]
 *             properties:
 *               name: { type: string }
 *               password: { type: string }
 *               role: { type: string, enum: [Employee], default: Employee }
 *               status: { type: string, enum: [Active, Inactive] }
 *               official:
 *                 type: object
 *                 required: [officialEmail, employeeCode]
 *               personal:
 *                 type: object
 *                 required: [dateOfBirth]
 *     responses:
 *       201: { description: Employee created. Welcome email is sent after the response. }
 *       400: { description: Validation failed / unique field conflict }
 *       403: { description: Role not allowed, wrong company, or create permission off }
 */
// CREATE EMPLOYEE — Super Admin / HR Manager only (Employee role = edit only, no create)
router.post(
  "/",
  protect,
  authorize("Super Admin", "Admin", "HR Manager"),
  checkPermission("Employee", "Employee", "create"),
  (req, _res, next) => {
    req.body.role = "Employee";
    next();
  },
  validate(createEmployeeSchema),
  createEmployee
);

/**
 * @swagger
 * /api/employees:
 *   get:
 *     tags: [Admin / Employees]
 *     summary: List employees
 *     description: |
 *       Employee Management table — **only** users with role `Employee`.
 *       For all roles (Access & Control) use `GET /api/users`.
 *
 *       **Who:** Super Admin, HR Manager, Manager (own company); Global Admin (all companies).
 *       **Employee role:** use `GET /api/employees/:id` for own profile — not this list.
 *
 *       **Columns:** name, email, role, department, lastLogin, status,
 *       employeeCode, gender, designation, branch.
 *
 *       **Search / filters (UI — All Employees):**
 *       - **search** / q — name, employee code, email, designation, department
 *       - **status** — All Status → Active | Inactive
 *       - **department** — All Departments
 *       - **designation** — All Designations
 *       - **gender** — All Gender
 *       - **company** / branch — optional company filter
 *       - **managerId** — employees reporting to this manager (either head)
 *       - **unassigned=true** — employees with no reporting manager (bulk assign screen)
 *       - page (default 1), limit (default 10, max 100)
 *
 *       Each row has `reportingHead1` / `reportingHead2` ({ _id, name, email, employeeCode } or null).
 *       Bulk assign the selected rows → `POST /api/employees/assign-manager` with the same companyId.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, example: EMP-1024 }
 *         description: Search name, code, email, designation, department
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 *       - in: query
 *         name: department
 *         schema: { type: string, example: Engineering }
 *       - in: query
 *         name: designation
 *         schema: { type: string, example: HR Executive }
 *       - in: query
 *         name: gender
 *         schema: { type: string, example: Male }
 *       - in: query
 *         name: company
 *         schema: { type: string }
 *         description: Company _id (24-hex) or company name. Matches official.companyIds.
 *       - in: query
 *         name: managerId
 *         schema: { type: string }
 *       - in: query
 *         name: unassigned
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, example: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, example: 10 }
 *     responses:
 *       200:
 *         description: Page of employees plus total, page, limit, from, to
 */
  // LIST EMPLOYEES — admin only (Employee Management table). Employee → GET /:id own profile.
router.get(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Employee", "Employee", "view"),
  listEmployees
);

/**
 * @swagger
 * /api/employees/activity:
 *   get:
 *     tags: [Admin / Employees, Employee / ESS]
 *     summary: Activity log — every employee change, company-wise
 *     description: |
 *       One API for all tracking: create / update / delete / manager assign, with field-level changes.
 *       Each log = `{ at, action, summary, company, employee{}, by{}, changes[{ field, label, from, to }] }`.
 *       **Employee** → own logs only (companyId / employeeId / search ignored).
 *       **Reporting Manager** → own team. **HR Manager** → own companies.
 *       **Super Admin / Admin** → all companies (pick one with companyId).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *         description: Company _id or company name
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *         description: One person — changes made on them OR by them
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-10-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-10-31" }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Employee name / code / email, changed-by name or summary text
 *       - in: query
 *         name: action
 *         schema: { type: string, enum: [create, update, delete, section_update, section_delete] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Paginated activity logs }
 */
router.get(
  "/activity",
  protect,
  (req, res, next) =>
    hasAllAccess(req.user)
      ? checkPermission("Employee", "Employee", "view")(req, res, next)
      : next(),
  listActivity
);

/**
 * @swagger
 * /api/employees/export:
 *   get:
 *     tags: [Admin / Employees]
 *     summary: Export employees Excel
 *     description: |
 *       **Who:** Global Admin, Super Admin, HR Manager, Manager
 *       (Employee → Employee → export). **Employee role has no export.**
 *       Same filters as list (search, status, department, designation, gender, company).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: .xlsx file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403: { description: Employee role or no export permission }
 */
// EXPORT EXCEL — admin only (not Employee role)
router.get(
  "/export",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Employee", "Employee", "export"),
  exportEmployees
);

/**
 * @swagger
 * /api/employees/assign-manager:
 *   post:
 *     tags: [Admin / Employees]
 *     summary: Bulk assign / remove Reporting Manager (company-wise)
 *     description: |
 *       Employee list → select company → tick employees → pick a manager of that company
 *       (`reportingManagers[]` from GET /api/companies/{id}) → send here.
 *       **Who:** Super Admin, Admin, HR Manager (own companies) with Employee → Employee → assign.
 *       `managerId: null` removes the manager (that `level`, or both heads when level is not sent).
 *       **Checks (all-or-nothing):** company active + yours; manager is an Active Reporting Manager
 *       of that company; every employee has role Employee and belongs to that company;
 *       same manager cannot be both heads. Any failure → 400 with `errors[]`, nothing changes.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyId, managerId, employeeIds]
 *             properties:
 *               companyId: { type: string, example: 6ac5e399dfa4b7cd5ad879a9 }
 *               managerId: { type: string, nullable: true, example: 6ac4b3e4d269e78d0eae7f64 }
 *               employeeIds:
 *                 type: array
 *                 items: { type: string }
 *                 example: [6ac4b3e7d269e78d0eae7f66, 6ac4b3f2d269e78d0eae7f68]
 *               level: { type: integer, enum: [1, 2], default: 1 }
 *     responses:
 *       200: { description: Updated employees with reportingHead1 / reportingHead2 }
 *       400: { description: "Validation failed — errors[] per employee" }
 *       403: { description: Company not yours / no edit permission }
 *       404: { description: Company or employee not found }
 */
router.post(
  "/assign-manager",
  protect,
  authorize("Super Admin", "Admin", "HR Manager"),
  checkPermission("Employee", "Employee", "assign"),
  validate(assignManagerSchema),
  assignReportingManager
);

/**
 * @swagger
 * /api/employees/upload:
 *   post:
 *     tags: [Admin / Employees, Employee / ESS]
 *     summary: Upload attachment to Cloudinary
 *     description: |
 *       No user id. Form-data: `document` (file) and `type` (`education` or `account`).
 *       Cloudinary folder is `hrms/<type>`. The same type always uses that same folder.
 *       Saves nothing in the database. On Submit, put the returned `url` in:
 *       - education → `education[].document`
 *       - account → `accounts[].attachment`
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document, type]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: PDF, image, Word, or Excel — max 5MB
 *               type:
 *                 type: string
 *                 enum: [education, account]
 *                 example: account
 *     responses:
 *       201:
 *         description: Cloudinary URL only
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: File uploaded
 *               type: account
 *               folder: hrms/account
 *               url: https://res.cloudinary.com/demo/raw/upload/v1/hrms/account/passbook.pdf
 *       400:
 *         description: Missing file, bad type, or invalid file
 *       500:
 *         description: Cloudinary not configured or upload failed
 */
// UPLOAD ATTACHMENT — Cloudinary; form-data: document + type (education|account)
// Admin: Employee→edit | Employee: Self→General Info→edit
router.post(
  "/upload",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  checkEmployeeProfilePermission("edit"),
  (req, res, next) => {
    uploadFile(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadAttachment
);

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     tags: [Admin / Employees, Employee / ESS]
 *     summary: Get one employee / my profile
 *     description: |
 *       **Admin:** any employee id (company scope).
 *       **Employee ESS:** own id only.
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
// Admin: Employee→view | Employee: Self→General Info→view (+ own id in controller)
router.get(
  "/:id",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  checkEmployeeProfilePermission("view"),
  getEmployee
);

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     tags: [Admin / Employees, Employee / ESS]
 *     summary: Update employee / my profile
 *     description: |
 *       **Admin:** any profile (company scope) | **Employee ESS:** own id only.
 *       **Who:** Admin (any) | Own profile
 *
 *       **Joi:** nested objects only — personal (addresses/emails/phones),
 *       official, other, education, etc. Flat city/company → 400. No contact module.
 *
 *       **Employee can update:** personal.mobileNo, personal.workPhone, personal.workExt
 *       (and other personal fields)
 *
 *       **Admin-only (official{}):** employeeCode, officialEmail, company, department, …
 *       Also: password (Super Admin/HR), payroll, role, status
 *
 *       **Unique when non-empty:** officialEmail, employeeCode, mobileNo,
 *       personalEmail, panNo, aadhaarNo, drivingLicenseNo, passportNo → 400 if duplicate
 *
 *       **Auto:** personal.anniversaryDate = next work anniversary from official.dateOfJoining
 *
 *       **Lists** (education, accounts, family, nominees, experience, visas):
 *       send one object to append, or the same object with `_id` to edit that row.
 *       Send the full array only when replacing the list (for example to delete a row).
 *
 *       **Files:** POST /api/employees/upload with type `education` or `account`.
 *       Cloudinary folder is `hrms/education` or `hrms/account`. Put `url` on Submit.
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
 *                 name: Shivi Gupta
 *                 personal:
 *                   dateOfBirth: "1995-06-15"
 *                   gender: Female
 *                   maritalStatus: Single
 *                   fatherOrHusbandName: Ramesh Iyer
 *                   panNo: ABCDE1234F
 *                   aadhaarNo: "123456789012"
 *                   personalEmail: shivi.gupta.personal@gmail.com
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
 *                   officialEmail: shivi.gupta@techculture.ai
 *                   company: TechCulture.Ai Private Limited
 *                   department: Finance
 *                   designation: Finance Executive
 *                   reportingHead1: 6ac4b3e4d269e78d0eae7f64
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
 *                 accounts:
 *                   - bankName: HDFC Bank
 *                     accountNo: "50100123456789"
 *                     accountHolderName: Shivi Gupta
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
 *                   personalEmail: shivi.gupta.personal@gmail.com
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
 *                 accounts:
 *                   - bankName: HDFC Bank
 *                     accountNo: "50100123456789"
 *                     accountHolderName: Shivi Gupta
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
 *       403: { description: No permission / wrong company }
 */
// UPDATE PROFILE — one API; role checks in controller + matrix permission here
// Admin: Employee→Employee→edit | Employee: Self→General Info→edit
router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  checkEmployeeProfilePermission("edit"),
  validate(updateUserSchema),
  updateEmployee
);

/**
 * @swagger
 * /api/employees/{id}/{section}:
 *   delete:
 *     tags: [Admin / Employees]
 *     summary: Delete section rows or clear payroll
 *     description: |
 *       Does **not** delete the user. Use `DELETE /api/employees/{id}` for that.
 *
 *       **Lists** (education, accounts, family, nominees, experience, visas):
 *       body `{ _id }`, or an array of ids / `{ _id }` objects — deletes those rows.
 *       **payroll:** clears payroll fields. Admin only.
 *       Official cannot be deleted (holds login email).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: section
 *         required: true
 *         schema:
 *           type: string
 *           enum: [education, accounts, family, nominees, experience, visas, payroll]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [_id]
 *                 properties:
 *                   _id: { type: string }
 *               - type: array
 *                 items: { type: string }
 *           example:
 *             _id: 66f0a1b2c3d4e5f678901234
 *     responses:
 *       200: { description: Row(s) deleted or payroll cleared }
 *       400: { description: Official cannot be deleted / invalid id }
 *       403: { description: Locked / no permission / wrong company }
 *       404: { description: Item not found }
 */
// DELETE SECTION — list row(s) or clear payroll (does not delete the user)
// Admin: Employee→edit | Employee: Self→General Info→edit
router.delete(
  "/:id/:section",
  protect,
  authorize(...ALL_ACCESS, "Employee"),
  checkEmployeeProfilePermission("edit"),
  validateSectionDelete,
  deleteSection
);

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     tags: [Admin / Employees]
 *     summary: Delete employee (admin only)
 *     description: |
 *       **Who:** Global Admin, Super Admin, HR Manager, Manager
 *       with Employee → Employee → **delete** permission.
 *       **Employee role cannot delete** (blocked by authorize + permission).
 *       Cannot delete your own account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Cannot delete self }
 *       403: { description: Employee role or no delete permission }
 *       404: { description: Not found }
 */
// DELETE EMPLOYEE — admin only (ALL_ACCESS + Employee→delete). Employee role never.
router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Employee", "Employee", "delete"),
  deleteEmployee
);

module.exports = router;
