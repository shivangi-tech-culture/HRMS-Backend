/**
 * OpenAPI / Swagger definition
 *
 * Served at /api-docs
 * Keep in sync with: User.js, Joi validators, Postman collection.
 */
const swaggerJsdoc = require("swagger-jsdoc");
const { API_BASE_URL, isProduction, DEV_API_URL, PROD_API_URL } = require("./config/env");

/** Short guide — Admin vs Employee dashboards (match Postman folders) */
const description = [
  "HRMS API — **Admin Dashboard** vs **Employee Dashboard (ESS)**.",
  "",
  `| **Base URL** | \`${API_BASE_URL}\` |`,
  "| **Auth** | `POST /api/auth/login` → cookie + Bearer token. Swagger → **Authorize** |",
  "",
  "### 1. Admin Dashboard (catalog: `admin`)",
  "| Area | APIs |",
  "| --- | --- |",
  "| Roles & Permissions | `/api/roles`, `/api/permissions/modules`, role permission matrix |",
  "| Access & Control | `/api/users` CRUD, export, mail |",
  "| Employee Management | `/api/employees` list/create/export/delete, approve, official/payroll |",
  "| Masters | `/api/masters` create/update/delete |",
  "| Mail | `POST /api/mail/send` |",
  "| Attendance (admin) | `POST /api/attendance/manual`, `GET /api/attendance` list |",
  "",
  "### 2. Employee Dashboard — ESS (catalog: `employee`)",
  "| Area | APIs |",
  "| --- | --- |",
  "| My permissions | `GET /api/permissions/my` |",
  "| My profile | `GET/PUT /api/employees/:id` (own id only) |",
  "| Attendance (self) | punch-in, punch-out, `GET /api/attendance/today` |",
  "| Masters (dropdowns) | `GET /api/masters?type=…` |",
  "",
  "**Custom roles:** pick `catalog` admin|employee → grant modules → `checkPermission` enforces each action.",
  "",
  "**Seeded logins** (`npm run seed`, password `123456`)",
  "| Role | Email | Side |",
  "| --- | --- | --- |",
  "| Global Admin | `globaladmin@techculture.ai` | Admin |",
  "| Super Admin | `shivangi@techculture.ai` | Admin |",
  "| HR Manager | `hr@techculture.ai` | Admin |",
  "| Manager | `manager@techculture.ai` | Admin |",
  "| Employee | `shivig5964@gmail.com` | ESS |",
  "",
  "**Quick start:** Login → Authorize Bearer → open **Admin /** or **Employee /** tags below.",
].join("\n");

module.exports = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "HRMS API",
      version: "4.0.0",
      description,
    },
    servers: isProduction
      ? [
          { url: PROD_API_URL, description: "Production (Render)" },
          { url: DEV_API_URL, description: "Local development" },
        ]
      : [
          { url: DEV_API_URL, description: "Local development" },
          { url: PROD_API_URL, description: "Production (Render)" },
        ],
    tags: [
      { name: "Health", description: "API + MongoDB health (no auth)" },
      { name: "Auth", description: "Login / logout — use before Admin or Employee APIs" },
      {
        name: "Admin / Roles",
        description: "Admin Dashboard — role CRUD + permission matrix",
      },
      {
        name: "Admin / Permissions",
        description: "Admin Dashboard — catalogs (admin+employee) for Create Role",
      },
      {
        name: "Admin / Employees",
        description: "Admin Dashboard — Employee Management (list/create/export/delete)",
      },
      {
        name: "Admin / Users",
        description: "Admin Dashboard — Access & Control (/api/users)",
      },
      {
        name: "Admin / Masters",
        description: "Admin Dashboard — masters write; GET also used by ESS dropdowns",
      },
      {
        name: "Admin / Mail",
        description: "Admin Dashboard — Organization → Mail",
      },
      {
        name: "Admin / Attendance",
        description: "Admin Dashboard — manual mark + attendance list",
      },
      {
        name: "Employee / ESS",
        description:
          "Employee Dashboard — my permissions, own profile, punch in/out, my today",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste token from POST /api/auth/login",
        },
      },
      schemas: {
        RootResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            status: { type: "string", example: "ok" },
            message: { type: "string", example: "HRMS API is working" },
            name: { type: "string", example: "HRMS API" },
            version: { type: "string", example: "1.0.0" },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            status: {
              type: "string",
              enum: ["ok", "down"],
              example: "ok",
            },
            message: { type: "string", example: "HRMS API is healthy" },
            mongodb: {
              type: "string",
              example: "connected",
              description: "connected | disconnected",
            },
          },
        },
        LoginBody: {
          type: "object",
          required: ["officialEmail", "password"],
          properties: {
            officialEmail: {
              type: "string",
              example: "shivangi@techculture.ai",
              description: "Must match official.officialEmail",
            },
            password: { type: "string", example: "123456" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            message: { type: "string", example: "Login successful" },
            token: {
              type: "string",
              description: "JWT — also set as httpOnly cookie `token`; optional for Bearer/Swagger",
            },
            user: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string", example: "Shivangi Gupta" },
                officialEmail: { type: "string", example: "shivangi@techculture.ai" },
                role: { type: "string", example: "Super Admin" },
                department: { type: "string" },
                company: { type: "string" },
                status: { type: "string", example: "Active" },
                lastLogin: { type: "string", format: "date-time" },
                permissionCount: {
                  type: "string",
                  example: "254 of 254",
                  description: "granted true actions of max catalog actions for this role",
                },
                permissions: {
                  type: "array",
                  description: "Only true action flags (false keys omitted)",
                  items: { $ref: "#/components/schemas/PermissionBlock" },
                },
              },
            },
          },
        },
        PermissionActionFlags: {
          type: "object",
          description: "true/false flags on a page (stored on Role)",
          properties: {
            name: { type: "string", example: "General Info" },
            view: { type: "boolean" },
            create: { type: "boolean" },
            edit: { type: "boolean" },
            delete: { type: "boolean" },
            approve: { type: "boolean" },
            reject: { type: "boolean" },
            cancel: { type: "boolean" },
            assign: { type: "boolean" },
            download: { type: "boolean" },
            export: { type: "boolean" },
            import: { type: "boolean" },
            upload: { type: "boolean" },
            print: { type: "boolean" },
            email: { type: "boolean" },
            share: { type: "boolean" },
          },
        },
        PermissionBlock: {
          type: "object",
          properties: {
            module: { type: "string", example: "Self" },
            heading: { type: "string", example: "" },
            subModules: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionActionFlags" },
            },
          },
        },
        CatalogSubModule: {
          type: "object",
          properties: {
            name: { type: "string", example: "Attendance Summary" },
            actions: {
              type: "array",
              items: { type: "string" },
              example: ["view", "export", "download", "print"],
            },
          },
        },
        CatalogModule: {
          type: "object",
          properties: {
            module: { type: "string", example: "Dashboard" },
            heading: { type: "string", example: "Overview" },
            subModules: {
              type: "array",
              items: { $ref: "#/components/schemas/CatalogSubModule" },
            },
          },
        },
        PermissionsCatalogResponse: {
          type: "object",
          description: "side once per group — 2 items in data",
          properties: {
            actions: {
              type: "array",
              items: { type: "string" },
              example: [
                "view",
                "create",
                "edit",
                "delete",
                "approve",
                "reject",
                "download",
                "export",
                "import",
                "upload",
                "print",
                "email",
                "share",
                "cancel",
                "assign",
              ],
            },
            count: { type: "integer", example: 2 },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  side: {
                    type: "string",
                    enum: ["admin", "employee"],
                    example: "admin",
                  },
                  modules: {
                    type: "array",
                    items: { $ref: "#/components/schemas/CatalogModule" },
                  },
                },
              },
            },
          },
        },
        MyPermissionsResponse: {
          type: "object",
          description: "One permissions list — no menu",
          properties: {
            role: { type: "string", example: "Employee" },
            side: { type: "string", enum: ["admin", "employee"] },
            permissionCount: { type: "string", example: "57 of 57" },
            count: { type: "integer", example: 5 },
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionBlock" },
            },
          },
        },
        Address: {
          type: "object",
          additionalProperties: false,
          properties: {
            address: { type: "string", example: "Sector 62" },
            country: { type: "string", example: "India" },
            state: { type: "string", example: "DELHI" },
            city: { type: "string", example: "Noida" },
            pincode: { type: "string", example: "201301" },
          },
        },
        Personal: {
          type: "object",
          additionalProperties: false,
          description:
            "Unique when set: mobileNo, personalEmail, panNo, aadhaarNo, drivingLicenseNo, passportNo",
          properties: {
            dateOfBirth: { type: "string", format: "date", nullable: true, example: "1995-06-15" },
            aadhaarNo: { type: "string", example: "123456789012", description: "Unique when set" },
            panNo: { type: "string", example: "ABCDE1234F", description: "Unique when set" },
            gender: { type: "string", example: "Female" },
            fatherOrHusbandName: { type: "string", example: "Ramesh Iyer" },
            maritalStatus: { type: "string", example: "Single" },
            spouseName: { type: "string" },
            anniversaryDate: {
              type: "string",
              format: "date",
              nullable: true,
              description: "Auto from official.dateOfJoining — read-only",
            },
            personalEmail: {
              type: "string",
              example: "shivi.gupta.personal@gmail.com",
              description: "Unique when set",
            },
            languageKnown: { type: "string", example: "Hindi, English" },
            emergencyContact1: { type: "string", example: "Neha - 9876543210" },
            emergencyContact2: { type: "string" },
            drivingLicenseNo: {
              type: "string",
              example: "DL-0420110012345",
              description: "Unique when set",
            },
            licenseValidUpto: { type: "string", format: "date", nullable: true },
            passportNo: {
              type: "string",
              example: "J8765432",
              description: "Unique when set",
            },
            remarks: { type: "string" },
            presentAddress: { $ref: "#/components/schemas/Address" },
            permanentAddress: { $ref: "#/components/schemas/Address" },
            mobileNo: {
              type: "string",
              example: "9810044556",
              description: "Unique — employee can update",
            },
            workPhone: { type: "string", example: "0120-4000000" },
            workExt: { type: "string", example: "204" },
          },
        },
        Official: {
          type: "object",
          additionalProperties: false,
          description: "Admin only — Global Admin / Super Admin / HR Manager / Manager",
          properties: {
            employeeCode: {
              type: "string",
              example: "EMP-1024",
              description: "Unique when set",
            },
            officialEmail: {
              type: "string",
              example: "shivi.gupta@techculture.ai",
              description: "Login ID — unique",
            },
            company: {
              type: "string",
              example: "TechCulture.Ai Private Limited",
            },
            department: { type: "string", example: "Finance" },
            designation: { type: "string", example: "Finance Executive" },
            division: {
              type: "string",
              example: "HO",
              description: "Master name string (not ObjectId)",
            },
            employeeGroup: {
              type: "string",
              example: "Permanent",
              description: "Master name string (not ObjectId)",
            },
            reportingHead1: { type: "string", example: "Shivangi Gupta" },
            reportingHead2: { type: "string" },
            jobRole: { type: "string", example: "Executive" },
            dateOfJoining: {
              type: "string",
              format: "date",
              nullable: true,
              example: "2024-01-15",
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
            passportExpiry: {
              type: "string",
              format: "date",
              nullable: true,
              example: "2030-12-31",
            },
          },
        },
        EducationItem: {
          type: "object",
          additionalProperties: false,
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
              example:
                "https://res.cloudinary.com/demo/raw/upload/v1/hrms/education/marksheet.pdf",
            },
            remarks: { type: "string" },
          },
        },
        AccountItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            bankName: { type: "string", example: "HDFC Bank" },
            accountNo: { type: "string", example: "50100123456789" },
            accountHolderName: { type: "string", example: "Shivi Gupta" },
            ifscCode: { type: "string", example: "HDFC0001234" },
            location: { type: "string", example: "Noida" },
            remarks: { type: "string" },
            attachment: { type: "string" },
            active: { type: "boolean", example: true },
            salaryAccount: { type: "boolean", example: true },
          },
        },
        FamilyItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", example: "Ramesh Iyer" },
            relation: { type: "string", example: "Father" },
            dob: { type: "string", format: "date", nullable: true },
            occupation: { type: "string", example: "Business" },
            education: { type: "string" },
            aadhaarNo: { type: "string" },
            mobileNo: { type: "string", example: "9876501234" },
            mediclaim: { type: "boolean" },
          },
        },
        NomineeItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            nominateFor: { type: "string", example: "PF" },
            nomineeName: { type: "string", example: "Neha Iyer" },
            relation: { type: "string", example: "Sister" },
            dob: { type: "string", format: "date", nullable: true },
            amountPercent: { type: "number", example: 100 },
            address: { type: "string" },
            remarks: { type: "string" },
          },
        },
        ExperienceItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            organization: { type: "string", example: "Previous Corp" },
            designation: { type: "string", example: "Analyst" },
            location: { type: "string", example: "Noida" },
            fromDate: { type: "string", format: "date", example: "2020-07-01" },
            toDate: { type: "string", format: "date", example: "2023-12-31" },
            lastSalaryDrawn: { type: "string", example: "45000" },
            description: { type: "string" },
            remarks: { type: "string" },
          },
        },
        VisaItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            countryName: { type: "string", example: "USA" },
            visaType: { type: "string", example: "B1/B2" },
            visaNumber: { type: "string", example: "V1234567" },
            fromDate: { type: "string", format: "date", example: "2025-01-01" },
            toDate: { type: "string", format: "date", example: "2025-12-31" },
            remarks: { type: "string" },
          },
        },
        Payroll: {
          type: "object",
          additionalProperties: false,
          description: "Admin only. Optional on Create User and on update.",
          properties: {
            salaryGroup: { type: "string" },
            salaryDate: { type: "string" },
            appraisalDuration: { type: "string" },
            basic: { type: "number", example: 40000 },
            annualCtc: { type: "number", example: 600000 },
            grossSalary: { type: "number" },
            totalEarning: { type: "number" },
            totalDeduction: { type: "number" },
            appraisalDate: { type: "string", format: "date", nullable: true },
            paymentMode: { type: "string", example: "Bank" },
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
            bankName: { type: "string", example: "HDFC Bank" },
            bankAccount: { type: "string", example: "50100123456789" },
            ifsc: { type: "string", example: "HDFC0001234" },
          },
        },
        CreateUserBody: {
          type: "object",
          required: ["name", "password", "role", "status", "official"],
          description:
            "Same shape as User model. Global Admin → lean, empty company (Global Admin actor only). Super Admin → lean + company. Staff → full profile.",
          properties: {
            name: { type: "string", example: "Shivi Gupta" },
            password: { type: "string", example: "123456" },
            role: {
              type: "string",
              enum: [
                "Global Admin",
                "Super Admin",
                "HR Manager",
                "Manager",
                "Employee",
              ],
              example: "Employee",
            },
            status: {
              type: "string",
              enum: ["Active", "Inactive"],
              example: "Active",
            },
            official: {
              allOf: [{ $ref: "#/components/schemas/Official" }],
              required: ["officialEmail"],
              description:
                "officialEmail always. Global Admin: no company. Super Admin: company required (Global) / own (Super). Staff: department required.",
            },
            personal: { $ref: "#/components/schemas/Personal" },
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
        UpdateUserBody: {
          type: "object",
          description:
            "All nested objects. Admin: full. Employee: personal/other/arrays only (no official/payroll).",
          properties: {
            name: { type: "string", example: "Shivi Gupta" },
            password: {
              type: "string",
              example: "newpass123",
              description: "Global Admin / Super Admin / HR Manager only",
            },
            role: { type: "string" },
            status: { type: "string", enum: ["Active", "Inactive"] },
            personal: { $ref: "#/components/schemas/Personal" },
            official: {
              allOf: [{ $ref: "#/components/schemas/Official" }],
              description: "Admin only",
            },
            other: { $ref: "#/components/schemas/Other" },
            education: { $ref: "#/components/schemas/ListOrOneEducation" },
            accounts: { $ref: "#/components/schemas/ListOrOneAccount" },
            family: { $ref: "#/components/schemas/ListOrOneFamily" },
            nominees: { $ref: "#/components/schemas/ListOrOneNominee" },
            experience: { $ref: "#/components/schemas/ListOrOneExperience" },
            visas: { $ref: "#/components/schemas/ListOrOneVisa" },
            payroll: { $ref: "#/components/schemas/Payroll" },
          },
        },
        ListOrOneEducation: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/EducationItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/EducationItem" },
            },
          ],
        },
        ListOrOneAccount: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/AccountItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/AccountItem" },
            },
          ],
        },
        ListOrOneFamily: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/FamilyItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/FamilyItem" },
            },
          ],
        },
        ListOrOneNominee: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/NomineeItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/NomineeItem" },
            },
          ],
        },
        ListOrOneExperience: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/ExperienceItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/ExperienceItem" },
            },
          ],
        },
        ListOrOneVisa: {
          description:
            "One object appends, or updates that row when _id is sent. An array replaces the whole list.",
          oneOf: [
            { $ref: "#/components/schemas/VisaItem" },
            {
              type: "array",
              items: { $ref: "#/components/schemas/VisaItem" },
            },
          ],
        },
        PunchBody: {
          type: "object",
          required: ["source"],
          properties: {
            source: {
              type: "string",
              enum: ["web", "mobile", "biometric"],
              example: "web",
              description: "Self punch only — manual not allowed here",
            },
          },
        },
        ManualAttendanceBody: {
          type: "object",
          required: ["employeeId", "punchType", "time", "reason"],
          properties: {
            employeeId: {
              type: "string",
              example: "665f1a2b3c4d5e6f7a8b9c0d",
              description: "Target employee MongoDB ObjectId (24 hex)",
            },
            punchType: { type: "string", enum: ["in", "out"], example: "in" },
            time: {
              type: "string",
              example: "09:30",
              description: "HH:mm 24h",
              pattern: "^([01]\\d|2[0-3]):([0-5]\\d)$",
            },
            reason: { type: "string", example: "Forgot to punch" },
            remarks: { type: "string", example: "Approved by HR" },
          },
        },
        MongoId: {
          type: "string",
          pattern: "^[a-fA-F0-9]{24}$",
          example: "665f1a2b3c4d5e6f7a8b9c0d",
          description: "MongoDB ObjectId",
        },
        CreateRoleBody: {
          type: "object",
          required: ["name", "catalog", "permissions"],
          properties: {
            name: { type: "string", example: "Peon" },
            description: { type: "string", example: "Limited admin modules" },
            status: {
              type: "string",
              enum: ["Active", "Inactive"],
              example: "Active",
            },
            catalog: {
              type: "string",
              enum: ["admin", "employee"],
              example: "admin",
              description: "One catalog only — permissions decided at create",
            },
            permissions: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/PermissionBlock" },
              description:
                "Required. Only true actions are stored. Routes check this matrix via checkPermission.",
            },
          },
        },
        UpdateRoleBody: {
          type: "object",
          description: "Name cannot be changed. Global Admin / Super Admin roles cannot be updated.",
          properties: {
            description: { type: "string", example: "Team tasks" },
            status: {
              type: "string",
              enum: ["Active", "Inactive"],
              example: "Active",
            },
          },
        },
      },
      parameters: {
        UserId: {
          in: "path",
          name: "id",
          required: true,
          schema: { $ref: "#/components/schemas/MongoId" },
          description: "User / employee id (from login or create)",
        },
        RoleId: {
          in: "path",
          name: "id",
          required: true,
          schema: { $ref: "#/components/schemas/MongoId" },
          description: "Role id (from create / list roles)",
        },
        AttendanceDate: {
          in: "query",
          name: "date",
          required: false,
          schema: { type: "string", format: "date", example: "2026-09-23" },
          description: "Filter by date YYYY-MM-DD",
        },
        AttendanceSource: {
          in: "query",
          name: "source",
          required: false,
          schema: {
            type: "string",
            enum: ["web", "mobile", "biometric", "manual"],
            example: "web",
          },
          description: "Matches punchInSource or punchOutSource",
        },
      },
    },
  },
  apis: ["./src/routes/*.js"],
});
