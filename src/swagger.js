/**
 * OpenAPI / Swagger definition
 *
 * Served at http://localhost:9001/api-docs
 * Schemas match User.js and Joi validators (unknown keys rejected on update).
 */
const swaggerJsdoc = require("swagger-jsdoc");

module.exports = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "HRMS API",
      version: "3.2.0",
      description:
        "## Overview\n" +
        "Express + MongoDB HRMS with JWT and role-based access.\n\n" +
        "## Roles\n" +
        "- **Super Admin** — full access; `detailsApproval` = Approved by default\n" +
        "- **HR Manager / Manager** — same admin access as Super Admin; profile starts Unapproved\n" +
        "- **Employee** — own profile; starts Unapproved (locked if Approved)\n\n" +
        "## Create User mapping\n" +
        "- `officialEmail` → `personal.officialEmail` (login ID)\n" +
        "- `mobileNo` → `personal.mobileNo`\n" +
        "- `company`, `department` → `official`\n" +
        "- `city`, `state`, `country` (optional) → `personal.permanentAddress`\n" +
        "- Personal phones: `mobileNo`, `workPhone`, `workExt`\n" +
        "- **Employee update:** `PUT /api/employees/{id}` with `personal.mobileNo` / `workPhone` / `workExt` (locked if Approved)\n\n" +
        "## Update validation\n" +
        "Joi allows **only** listed keys inside `personal`, `official`, `education`, etc. Fake fields → 400.\n\n" +
        "## Education document (Cloudinary)\n" +
        "`POST /api/employees/{id}/education/document` → Cloudinary URL in `document`.\n" +
        "Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET\n\n" +
        "## Attendance punch source\n" +
        "- Self punch: `source` = `web` | `mobile` | `biometric`\n" +
        "- Stored as `punchInSource` / `punchOutSource` (no duplicate verification field)\n" +
        "- Admin Mark Attendance: always `manual` via `POST /api/attendance/manual`",
    },
    servers: [{ url: "http://localhost:9001", description: "Local backend" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Token from Login",
        },
      },
      schemas: {
        Address: {
          type: "object",
          additionalProperties: false,
          properties: {
            address: { type: "string" },
            country: { type: "string" },
            state: { type: "string" },
            city: { type: "string" },
            pincode: { type: "string" },
          },
        },
        Personal: {
          type: "object",
          additionalProperties: false,
          description: "Personal details + addresses + phones (emails only here)",
          properties: {
            employeeCode: {
              type: "string",
              description: "Admin only — employees cannot edit",
            },
            dateOfBirth: { type: "string", format: "date", nullable: true },
            aadhaarNo: { type: "string" },
            panNo: { type: "string" },
            gender: { type: "string", example: "Male" },
            fatherOrHusbandName: { type: "string" },
            maritalStatus: { type: "string" },
            spouseName: { type: "string" },
            anniversaryDate: {
              type: "string",
              format: "date",
              nullable: true,
              description:
                "Auto: next work anniversary from official.dateOfJoining (read-only)",
            },
            officialEmail: {
              type: "string",
              example: "ananya@techculture.ai",
              description: "Login ID",
            },
            personalEmail: { type: "string" },
            languageKnown: { type: "string" },
            emergencyContact1: { type: "string" },
            emergencyContact2: { type: "string" },
            drivingLicenseNo: { type: "string" },
            licenseValidUpto: { type: "string", format: "date", nullable: true },
            passportNo: { type: "string" },
            remarks: { type: "string" },
            presentAddress: { $ref: "#/components/schemas/Address" },
            permanentAddress: { $ref: "#/components/schemas/Address" },
            mobileNo: {
              type: "string",
              example: "9810044556",
              description: "Employee can update via PUT personal{}",
            },
            workPhone: {
              type: "string",
              example: "",
              description: "Employee can update via PUT personal{}",
            },
            workExt: {
              type: "string",
              example: "",
              description: "Employee can update via PUT personal{}",
            },
          },
        },
        Official: {
          type: "object",
          additionalProperties: false,
          description: "Admin only — employees cannot update any official field",
          properties: {
            company: { type: "string" },
            department: { type: "string" },
            designation: { type: "string", example: "Finance Executive" },
            reportingHead1: { type: "string" },
            reportingHead2: { type: "string" },
            jobRole: { type: "string" },
            dateOfJoining: {
              type: "string",
              format: "date",
              nullable: true,
              description: "Sets personal.anniversaryDate automatically",
            },
            calculateSalaryFrom: { type: "string", format: "date", nullable: true },
            dateOfRetirement: { type: "string", format: "date", nullable: true },
            grade: { type: "string", example: "G4" },
          },
        },
        Other: {
          type: "object",
          additionalProperties: false,
          properties: {
            bloodGroup: { type: "string", example: "B+" },
            passportExpiry: { type: "string", format: "date", nullable: true },
          },
        },
        EducationItem: {
          type: "object",
          additionalProperties: false,
          description: "Add Education History — Upload Document supported",
          properties: {
            courseType: { type: "string", example: "Full Time" },
            courseLevel: { type: "string", example: "Graduation" },
            courseName: { type: "string", example: "B.Tech" },
            instituteName: { type: "string", example: "ABC College" },
            location: { type: "string", example: "Noida" },
            fromYear: { type: "string", example: "2016" },
            passingYear: { type: "string", example: "2020" },
            major: { type: "string" },
            minor: { type: "string" },
            percentageOrGrade: { type: "string", example: "8.2 CGPA" },
            document: {
              type: "string",
              example: "https://res.cloudinary.com/demo/raw/upload/v1/hrms/education/marksheet.pdf",
              description: "Cloudinary secure URL from upload API",
            },
            documentName: {
              type: "string",
              example: "marksheet.pdf",
              description: "Original file name",
            },
            remarks: { type: "string" },
          },
        },
        AccountItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            bankName: { type: "string" },
            accountNo: { type: "string" },
            accountHolderName: { type: "string" },
            ifscCode: { type: "string" },
            location: { type: "string" },
            remarks: { type: "string" },
            attachment: { type: "string" },
            active: { type: "boolean" },
            salaryAccount: { type: "boolean" },
          },
        },
        FamilyItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            relation: { type: "string", example: "Spouse" },
            dob: { type: "string", format: "date", nullable: true },
            occupation: { type: "string" },
            education: { type: "string" },
            aadhaarNo: { type: "string" },
            mobileNo: { type: "string" },
            mediclaim: { type: "boolean" },
          },
        },
        NomineeItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            nominateFor: { type: "string", example: "PF" },
            nomineeName: { type: "string" },
            relation: { type: "string" },
            dob: { type: "string", format: "date", nullable: true },
            amountPercent: { type: "number" },
            address: { type: "string" },
            remarks: { type: "string" },
          },
        },
        ExperienceItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            organization: { type: "string" },
            designation: { type: "string" },
            location: { type: "string" },
            fromDate: { type: "string", format: "date", nullable: true },
            toDate: { type: "string", format: "date", nullable: true },
            lastSalaryDrawn: { type: "string" },
            description: { type: "string" },
            remarks: { type: "string" },
          },
        },
        VisaItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            countryName: { type: "string" },
            visaType: { type: "string" },
            visaNumber: { type: "string" },
            fromDate: { type: "string", format: "date", nullable: true },
            toDate: { type: "string", format: "date", nullable: true },
            remarks: { type: "string" },
          },
        },
        Payroll: {
          type: "object",
          additionalProperties: false,
          description: "Admin only — not on Create User",
          properties: {
            salaryGroup: { type: "string" },
            salaryDate: { type: "string" },
            appraisalDuration: { type: "string" },
            basic: { type: "number" },
            annualCtc: { type: "number" },
            grossSalary: { type: "number" },
            totalEarning: { type: "number" },
            totalDeduction: { type: "number" },
            appraisalDate: { type: "string", format: "date", nullable: true },
            paymentMode: { type: "string" },
            ot1Rate: { type: "number" },
            ot2Rate: { type: "number" },
            remarks: { type: "string" },
            uanNo: { type: "string" },
            pfApply: { type: "boolean" },
            pfEmployerShare: { type: "boolean" },
            pfNo: { type: "string" },
            pfType: { type: "string" },
            pf: { type: "string" },
            pfApplyFrom: { type: "string", format: "date", nullable: true },
            pfApplyTo: { type: "string", format: "date", nullable: true },
            esiApply: { type: "boolean" },
            esiNo: { type: "string" },
            esiEmployerShare: { type: "boolean" },
            esiApplyFrom: { type: "string", format: "date", nullable: true },
            esiApplyTo: { type: "string", format: "date", nullable: true },
            ptApply: { type: "boolean" },
            tdsApply: { type: "boolean" },
            taxRegime: { type: "string", example: "New" },
            bankName: { type: "string" },
            bankAccount: { type: "string" },
            ifsc: { type: "string" },
          },
        },
        CreateUserBody: {
          type: "object",
          required: [
            "name",
            "officialEmail",
            "password",
            "role",
            "company",
            "department",
            "status",
          ],
          properties: {
            name: { type: "string", example: "Ananya Iyer" },
            officialEmail: {
              type: "string",
              example: "ananya@techculture.ai",
              description: "→ personal.officialEmail (login ID)",
            },
            mobileNo: {
              type: "string",
              example: "9810044556",
              description: "→ personal.mobileNo",
            },
            password: { type: "string", example: "123456" },
            role: {
              type: "string",
              enum: ["Super Admin", "HR Manager", "Manager", "Employee"],
              example: "Employee",
            },
            company: {
              type: "string",
              example: "TechCulture Solutions Private Limited",
            },
            department: { type: "string", example: "Finance" },
            city: { type: "string", example: "Noida" },
            state: { type: "string", example: "DELHI" },
            country: { type: "string", example: "India" },
            status: { type: "string", enum: ["Active", "Inactive"] },
          },
        },
        UpdateUserBody: {
          type: "object",
          description:
            "Nested profile update. Employee may set personal.mobileNo, workPhone, workExt (and other personal fields) while Unapproved/Rejected. official{} = admin only.",
          properties: {
            name: { type: "string" },
            password: {
              type: "string",
              description: "Super Admin / HR Manager only",
            },
            role: { type: "string" },
            status: { type: "string", enum: ["Active", "Inactive"] },
            detailsApproval: {
              type: "string",
              enum: ["Unapproved", "Approved", "Rejected"],
              description: "Admin only",
            },
            personal: { $ref: "#/components/schemas/Personal" },
            official: {
              allOf: [{ $ref: "#/components/schemas/Official" }],
              description: "Admin only — full object",
            },
            other: { $ref: "#/components/schemas/Other" },
            education: {
              type: "array",
              items: { $ref: "#/components/schemas/EducationItem" },
            },
            accounts: {
              type: "array",
              items: { $ref: "#/components/schemas/AccountItem" },
            },
            family: {
              type: "array",
              items: { $ref: "#/components/schemas/FamilyItem" },
            },
            nominees: {
              type: "array",
              items: { $ref: "#/components/schemas/NomineeItem" },
            },
            experience: {
              type: "array",
              items: { $ref: "#/components/schemas/ExperienceItem" },
            },
            visas: {
              type: "array",
              items: { $ref: "#/components/schemas/VisaItem" },
            },
            payroll: { $ref: "#/components/schemas/Payroll" },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.js"],
});
