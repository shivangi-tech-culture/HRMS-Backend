/**
 * Employee / User routes → /api/employees
 *
 * Middleware order: protect → authorize(roles) → validate(Joi) → controller
 *
 * Roles:
 *   Create          → Super Admin, HR Manager
 *   List / Get / Update → Super Admin, HR Manager, Manager, Employee
 *   Delete          → Super Admin, HR Manager, Manager
 *
 * Create mapping: officialEmail → personal.officialEmail
 *                 mobileNo → personal.mobileNo
 *                 company/department → official
 *                 city/state/country → personal.permanentAddress
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
 *       **Optional:** city, state, country
 *
 *       **Saved as:** officialEmail → personal.officialEmail |
 *       mobileNo → personal.mobileNo | company/department → official |
 *       city/state/country → personal.permanentAddress |
 *       detailsApproval = Approved (Super Admin only) | Unapproved (HR / Manager / Employee)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserBody'
 *     responses:
 *       201: { description: User created (emailSent true/false) }
 *       400: { description: Validation failed / official email exists }
 *       403: { description: Role not allowed }
 */
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
 *       **Form-data field:** `document`
 *       **Allowed:** PDF, JPG, PNG, DOC (max 5MB)
 *       **Storage:** Cloudinary — returns secure URL in `document`
 *       Put `document` + `documentName` into education[] via PUT.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *                 description: Certificate or marksheet (uploaded to Cloudinary)
 *     responses:
 *       201:
 *         description: Uploaded to Cloudinary — returns document (URL) and documentName
 *       400:
 *         description: No file or invalid type
 *       500:
 *         description: Cloudinary not configured or upload failed
 */
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
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Single employee profile
 *       403:
 *         description: Not own profile
 *       404:
 *         description: Not found
 */
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
 *       **Admin-only:** detailsApproval (Unapproved|Approved|Rejected), official{},
 *       personal.employeeCode, password (Super Admin/HR), payroll, role, status
 *
 *       **Auto:** personal.anniversaryDate = next work anniversary from official.dateOfJoining
 *
 *       **Education + document:** upload via POST .../education/document, then PUT education[] with
 *       `document` + `documentName`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserBody'
 *           examples:
 *             approve:
 *               summary: Approve details
 *               value: { detailsApproval: Approved }
 *             phones:
 *               summary: Employee update phones (mobileNo / workPhone / workExt)
 *               value:
 *                 personal:
 *                   mobileNo: "9810044556"
 *                   workPhone: ""
 *                   workExt: ""
 *             education:
 *               summary: Education with uploaded document
 *               value:
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
 *             personal:
 *               summary: Update personal (incl. phones)
 *               value:
 *                 personal:
 *                   gender: Female
 *                   panNo: ABCDE1234F
 *                   mobileNo: "9810044556"
 *                   workPhone: ""
 *                   workExt: ""
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Unknown / invalid fields }
 *       403: { description: Locked after Approved / no permission }
 */
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
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Cannot delete self }
 *       404: { description: Not found }
 */
router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  deleteEmployee
);

module.exports = router;
