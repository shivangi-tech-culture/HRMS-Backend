# HRMS API

A simple, ready-to-use **Human Resource Management System** backend built with **Node.js**, **Express**, and **MongoDB**.

It handles login, roles and permissions, employee profiles, education document upload, and attendance (punch in/out plus admin manual mark).

---

## What this project does

Think of this as the **backend brain** for an HRMS app (web or mobile).

| Area | What you get |
|------|----------------|
| **Auth** | Login with official email + password, JWT token |
| **Roles** | Super Admin, HR Manager, Manager, Employee |
| **Permissions** | Full admin menu + employee (ESS) menu catalog |
| **Employees** | Create user, full profile CRUD, details approval |
| **Attendance** | Self punch (web / mobile / biometric) + admin manual |
| **Health** | `GET /api/health` — API + MongoDB status (no auth) |
| **Docs** | Swagger UI + Postman collection |

**Default port:** `9001`  
**API docs:** http://localhost:9001/api-docs

---

## Tech stack

| Tool | Why we use it |
|------|----------------|
| **Express** | HTTP API server |
| **MongoDB + Mongoose** | Database + models |
| **JWT** | Secure login sessions |
| **bcryptjs** | Password hashing |
| **Joi** | Request body validation |
| **Multer + Cloudinary** | Education document upload |
| **Nodemailer** | Welcome email on user create |
| **Swagger** | Interactive API documentation |
| **Postman** | Ready-made request collection |
| **Helmet** | Secure HTTP headers |
| **Morgan** | Colored HTTP request logs |
| **express-rate-limit** | Brute-force / flood protection |
| **Chalk** | Colored server console output |

---

## Quick start (5 minutes)

### 1. Prerequisites

- **Node.js** 18+ (recommended)
- **MongoDB** running locally (or a cloud URI)

### 2. Install

```bash
cd "HRMS PROJECT"
npm install
```

### 3. Environment file

Copy the example file and fill in your values:

```bash
copy .env.example .env
```

Minimum you need for local run:

```env
PORT=9001
MONGODB_URI=mongodb://127.0.0.1:27017/hrms
JWT_SECRET=change_this_in_production
JWT_EXPIRES_IN=7d
```

Optional (for emails + file upload):

- Zoho SMTP: `EMAIL_USER_EZ`, `EMAIL_PASS_EZ`, `SMTP_HOST_EZ`, `SMTP_PORT_EZ`
- Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

### 4. Seed sample data

This **clears** users/roles and creates fresh sample accounts:

```bash
npm run seed
```

### 5. Start the server

```bash
npm run dev
```

Or:

```bash
npm start
```

You should see:

```text
HRMS backend → http://localhost:9001
Swagger docs → http://localhost:9001/api-docs
```

---

## Seeded login accounts

After `npm run seed`:

| Role | Official email (login ID) | Password |
|------|---------------------------|----------|
| **Super Admin** | `shivangi@techculture.ai` | `123456` |
| **Employee** | `shivig5964@gmail.com` | `123456` |

Login always uses **`official.officialEmail`** + password.  
There is **no public signup** — only admins create users.

---

## Roles explained (simple)

| Role | Side | What they can do |
|------|------|------------------|
| **Super Admin** | Admin | Everything. Profile starts **Approved**. |
| **HR Manager** | Admin | Same admin access as Super Admin. Can create users and reset passwords. |
| **Manager** | Admin | Same admin modules. Cannot create users (create = Super Admin / HR). |
| **Employee** | ESS | Own profile + own attendance. Locked after **Approved**. |

**Admin roles** = Super Admin, HR Manager, Manager.

---

## How login and security work

```text
1. POST /api/auth/login  { officialEmail, password }
2. Server checks user + Active status
3. Returns JWT token + user + permissions
4. For other APIs, send header:
   Authorization: Bearer <token>
```

Important points:

- Login response has **`permissions` only** (no duplicate `menu` field).
- Inactive users cannot log in.
- Most routes need a valid Bearer token.

---

## Permissions (for frontend menus)

### Catalog (full map for UI builders)

```http
GET /api/permissions/modules
```

Response shape:

```json
{
  "actions": ["view", "create", "edit"],
  "count": 2,
  "data": [
    { "side": "admin", "modules": [] },
    { "side": "employee", "modules": [] }
  ]
}
```

- `side` appears **once per group** (not repeated on every module).
- Source of truth: `src/config/permissions.js`

### My permissions (for the logged-in user)

```http
GET /api/permissions/my
```

```json
{
  "role": "Employee",
  "side": "employee",
  "permissionCount": "57 of 57",
  "count": 5,
  "data": []
}
```

**Sidebar tip:** show pages where `view === true`.

---

## Employees / Users

Base path: `/api/employees`

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| `POST` | `/` | Super Admin, HR Manager | Create user |
| `GET` | `/` | All logged-in | List (admin = all, employee = self) |
| `GET` | `/:id` | All logged-in | Get one profile |
| `PUT` | `/:id` | All logged-in | Update profile |
| `DELETE` | `/:id` | Admin roles | Delete user (not yourself) |
| `POST` | `/:id/education/document` | All logged-in | Upload certificate to Cloudinary |

Employee can only touch **own** profile, and only while `detailsApproval` is not `Approved`.

### Create User — body mapping

Create uses a **flat** body. The server saves nested fields:

| You send | Saved as |
|----------|----------|
| `officialEmail` | `official.officialEmail` (login ID) |
| `employeeCode` | `official.employeeCode` |
| `mobileNo` | `personal.mobileNo` |
| `company`, `department` | `official` |
| `city`, `state`, `country` | `personal.permanentAddress` |

**Required:** `name`, `officialEmail`, `password`, `role`, `company`, `department`, `status`  
**Optional:** `employeeCode`, `mobileNo`, `city`, `state`, `country`

Example:

```json
{
  "name": "Ananya Iyer",
  "officialEmail": "ananya@techculture.ai",
  "employeeCode": "EMP-1024",
  "mobileNo": "9810044556",
  "password": "123456",
  "role": "Employee",
  "company": "TechCulture Solutions Private Limited",
  "department": "Finance",
  "city": "Noida",
  "state": "DELHI",
  "country": "India",
  "status": "Active"
}
```

### Update User — one PUT for everything

```http
PUT /api/employees/:id
```

Send **nested objects** (not the flat create fields).

| Object | Who can edit |
|--------|----------------|
| `personal` | Employee (if not Approved) + Admin |
| `other` | Employee (if not Approved) + Admin |
| `education`, `accounts`, `family`, `nominees`, `experience`, `visas` | Employee (if not Approved) + Admin |
| `official` | **Admin only** |
| `payroll` | **Admin only** |
| `detailsApproval`, `role`, `status` | **Admin only** |
| `password` | **Super Admin / HR Manager only** |

**`detailsApproval` values:** `Unapproved` | `Approved` | `Rejected`

- Super Admin users are created as **Approved**
- Others start as **Unapproved**
- When **Approved**, employee cannot edit own profile anymore (admin still can)

### Unique identity fields

These must be unique when **not empty**:

- `official.officialEmail`
- `official.employeeCode`
- `personal.mobileNo`
- `personal.personalEmail`
- `personal.panNo`
- `personal.aadhaarNo`
- `personal.drivingLicenseNo`
- `personal.passportNo`

Duplicate returns **400** with a clear message.

### Education document upload

UI flow (Add Education form — one Submit):

1. User file choose kare → `POST /api/employees/:id/education/document`  
   Form-data: sirf `document` (file)  
2. Response: `document` (Cloudinary URL) + `documentName`  
3. Submit pe → `PUT /api/employees/:id` with `education[]` (form fields + URL)

Upload API **DB update nahi karti** — sirf URL deti hai.

Allowed: PDF, JPG, PNG, DOC (max **5 MB**)

---

## Attendance

Base path: `/api/attendance`

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| `POST` | `/punch-in` | Logged-in | Punch in |
| `POST` | `/punch-out` | Logged-in | Punch out |
| `POST` | `/manual` | Admin only | Mark missed punch |
| `GET` | `/today` | Logged-in | My today record |
| `GET` | `/` | Logged-in | List (admin = all, employee = own) |

### Self punch

```json
{ "source": "web" }
```

Allowed sources: **`web`** | **`mobile`** | **`biometric`**  
Employees **cannot** use `manual`.

### Admin manual mark

```json
{
  "employeeId": "665f1a2b3c4d5e6f7a8b9c0d",
  "punchType": "in",
  "time": "09:30",
  "reason": "Forgot to punch",
  "remarks": "Approved by HR"
}
```

- Date is always **today** (client cannot set another date)
- Source is always stored as **`manual`**

### List filters (optional)

```http
GET /api/attendance?date=2026-09-23&source=web
```

---

## Auth and Roles API summary

### Auth — `/api/auth`

| Method | Path | Auth? | Purpose |
|--------|------|-------|---------|
| `POST` | `/login` | No | Login |
| `GET` | `/me` | Yes | Current user + permissions |

### Roles — `/api/roles`

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/` | Create role |
| `GET` | `/` | List roles |
| `GET` | `/:id` | Get one role |
| `PUT` | `/:id` | Update role |
| `DELETE` | `/:id` | Delete role (Super Admin) |
| `GET` | `/:id/permissions` | Get permission matrix |
| `PUT` | `/:id/permissions` | Save permission matrix |

---

## Project folder structure

```text
HRMS PROJECT/
├── postman/
│   └── HRMS_API.postman_collection.json
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── permissions.js
│   ├── controllers/
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── validate.js
│   │   └── upload.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Role.js
│   │   └── Attendance.js
│   ├── routes/
│   ├── validators/
│   ├── utils/
│   ├── seed.js
│   ├── swagger.js
│   └── server.js
├── .env.example
├── package.json
└── README.md
```

---

## User profile modules (what is stored)

One user document holds the full employee file:

1. **Account** — name, password, role, status, detailsApproval, lastLogin
2. **personal** — DOB, IDs, phones, emails, addresses, emergency contacts
3. **official** — employeeCode, officialEmail, company, dept, joining date
4. **other** — blood group, passport expiry
5. **education[]** — courses + optional document URL
6. **accounts[]** — bank accounts
7. **family[]** — family members
8. **nominees[]** — PF / insurance nominees
9. **experience[]** — past jobs
10. **visas[]** — visa records
11. **payroll** — salary / PF / ESI / TDS (admin only)

`personal.anniversaryDate` is **auto-calculated** from `official.dateOfJoining` (next work anniversary).

---

## Testing the API

### Option A — Swagger (browser)

1. Start server
2. Open http://localhost:9001/api-docs
3. Call **Login** and copy `token`
4. Click **Authorize** and paste `Bearer <token>`
5. Try any protected API

Swagger includes path params, attendance query params, and full Create / Update examples (Super Admin vs Employee).

### Option B — Postman

1. Import `postman/HRMS_API.postman_collection.json`
2. Collection variable `baseUrl` = `http://localhost:9001`
3. Run **Login Super Admin** — sets `token` and `userId`
4. All other requests reuse those variables

---

## Typical workflows

### A. Admin creates an employee

1. Login as Super Admin / HR Manager
2. `POST /api/employees` with create body
3. Employee gets welcome email (if SMTP is configured)
4. Employee logs in with `officialEmail` + password

### B. Employee fills profile

1. Login as Employee
2. `PUT /api/employees/:id` with `personal`, `other`, arrays
3. Upload education file, then put URL into `education[]`
4. Admin sets `detailsApproval: "Approved"`
5. Profile becomes read-only for the employee

### C. Daily attendance

1. Employee: `POST /punch-in` with `{ "source": "web" }`
2. Later: `POST /punch-out`
3. If missed: Admin calls `POST /manual`

---

## NPM scripts

| Command | What it does |
|---------|----------------|
| `npm install` | Install dependencies |
| `npm run seed` | Reset DB sample roles + users |
| `npm run dev` | Start with auto-reload |
| `npm start` | Start normally |

---

## Environment variables (reference)

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `PORT` | No (default 9001) | Server port |
| `NODE_ENV` | No (default development) | `development` uses localhost; `production` uses `API_BASE_URL` |
| `API_BASE_URL` | No | Public API URL in production (`https://hrms-backend-py1t.onrender.com`) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Signs / verifies tokens |
| `JWT_EXPIRES_IN` | No (default 7d) | Token lifetime |
| `APP_URL` | No | Link used in emails |
| `EMAIL_USER_EZ` | For mail | SMTP username |
| `EMAIL_PASS_EZ` | For mail | SMTP password |
| `SMTP_HOST_EZ` | For mail | e.g. `smtp.zoho.com` |
| `SMTP_PORT_EZ` | For mail | e.g. `587` |
| `EMAIL_FROM_NAME` | No | From display name |
| `CLOUDINARY_*` | For uploads | Education document storage |
| `RATE_LIMIT_WINDOW_MS` | No (default 900000) | Rate-limit window in ms (15 min) |
| `RATE_LIMIT_MAX` | No (default 200) | Max requests per IP per window |
| `RATE_LIMIT_LOGIN_MAX` | No (default 20) | Max login attempts per IP per window |

See `.env.example` for a full template (same structure as `.env`).

---

## Security middleware

| Package | Purpose |
|---------|---------|
| **helmet** | Sets safe HTTP headers (XSS, clickjacking, etc.) |
| **morgan** | Logs every request with colored status codes |
| **express-rate-limit** | Limits requests per IP (global + stricter on login) |
| **chalk** | Colored MongoDB / server startup messages |

---

## Rate limit kya hai? (simple explanation)

**Rate limit** = ek IP address se **kitni baar** API call kar sakte ho ek **time window** mein.

### Kyun use karte hain?

1. Koi bhi server ko spam / flood karke crash na kar sake  
2. Login pe hazaron password try (brute-force) na ho sake  
3. Shared hosting / DB pe load control rahe  

### Humare project ke numbers (default)

| Limit | Kitni baar | Kitne time mein | Kis pe lagta hai |
|-------|------------|-----------------|------------------|
| **Global** | **200** requests | **15 minutes** | Almost saari APIs (health, employees, attendance, …) |
| **Login** | **20** attempts | **15 minutes** | Sirf `POST /api/auth/login` |

Matlab:

- Aap **15 minute** mein max **200** API calls kar sakte ho (same IP se)  
- Login alag se: **15 minute** mein max **20** baar login try  
- Uske baad server **HTTP 429** deta hai:  
  `"Too many requests from this IP. Please try again later."`  
  (login pe: `"Too many login attempts…"`)

### `.env` se change kaise karein

```env
# 900000 ms = 15 minutes
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
RATE_LIMIT_LOGIN_MAX=20
```

| Variable | Meaning |
|----------|---------|
| `RATE_LIMIT_WINDOW_MS` | Window size in **milliseconds** (900000 = 15 min) |
| `RATE_LIMIT_MAX` | Global max requests per IP in that window |
| `RATE_LIMIT_LOGIN_MAX` | Max login attempts per IP in that window |

Examples:

- Testing / Postman pe limit jaldi hit ho: `RATE_LIMIT_MAX=1000`  
- Production mein login tight: `RATE_LIMIT_LOGIN_MAX=10`  
- Window 1 hour: `RATE_LIMIT_WINDOW_MS=3600000`

### Important notes

- Count **per IP** hota hai (same Wi‑Fi / office often = same IP)  
- Global + login **dono** apply hote hain — login pe pehle global count bhi badhta hai  
- Response headers mein remaining quota dikh sakta hai (`RateLimit-*`)  
- Code comments: `src/server.js` (Rate Limit section)

---

## Common problems and fixes

| Problem | Likely fix |
|---------|------------|
| Cannot connect to DB | Start MongoDB; check `MONGODB_URI` |
| `Please login first` | Missing or invalid `Authorization: Bearer …` |
| `Access denied` | Your role is not allowed for that route |
| Profile update blocked | `detailsApproval` is `Approved` (ask admin) |
| Unique field error | Email / mobile / PAN / etc. already used |
| Cloudinary error | Set Cloudinary keys in `.env` |
| PDF opens but **"Failed to load PDF document"** | Cloudinary Free blocks PDF delivery. Console → **Settings → Security** → enable **Allow delivery of PDF and ZIP files** → Save → upload again |
| Mail failed on seed | SMTP optional — seed still creates users |
| Old login still shows `menu` | Restart server; response no longer includes menu |
| `Too many requests` (429) | Rate limit hit — wait for window, or raise `RATE_LIMIT_*` in `.env` |

## API quick map

```text
http://localhost:9001/
├── /api-docs                 Swagger UI
├── /api/health               Health (API + MongoDB)
├── /api/auth
│   ├── POST /login
│   └── GET  /me
├── /api/permissions
│   ├── GET /modules
│   └── GET /my
├── /api/roles
│   ├── CRUD /:id
│   └── /:id/permissions
├── /api/employees
│   ├── CRUD /:id
│   └── /:id/education/document
└── /api/attendance
    ├── POST /punch-in
    ├── POST /punch-out
    ├── POST /manual
    ├── GET  /today
    └── GET  /                ?date=&source=
```

---

## Design notes (for developers)

- **No public signup** — users are created by Super Admin / HR Manager only
- **One update API** — nested objects; create is flat then mapped to nested
- **Permissions catalog** lives in code (`permissions.js`), not separate DB collections
- **Partial unique indexes** — empty strings do not block uniqueness
- **Request validation** — Joi rejects unknown fields on key schemas
- Keep **Swagger** (`src/swagger.js` + route JSDoc) and **Postman** in sync when APIs change

---

## License / usage

Internal project boilerplate for TechCulture HRMS.  
Change `JWT_SECRET`, SMTP, and Cloudinary credentials before any production deploy.
