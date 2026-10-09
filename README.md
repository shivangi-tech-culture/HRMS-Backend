# HRMS API

Backend for a **Human Resource Management System** — Node.js, Express, MongoDB.

Supports **web** (httpOnly cookie) and **mobile** (Bearer JWT). No public signup; admins create users.

| | |
|--|--|
| **Default port** | `9001` |
| **Swagger** | http://localhost:9001/api-docs |
| **Health** | http://localhost:9001/api/health |
| **Postman** | `postman/HRMS_API.postman_collection.json` |

---

## Architecture overview

```text
                    ┌─────────────────┐
   Web (Vercel) ──► │  CORS + cookie  │
                    │  credentials    │
   Mobile app ────► │  Bearer JWT     │──► Express (server.js)
                    └─────────────────┘            │
                                                   ▼
              ┌────────────────────────────────────────────────┐
              │  Middleware stack                              │
              │  helmet → cors → cookieParser → json → morgan  │
              │  → rate-limit → routes                         │
              └────────────────────────────────────────────────┘
                   │
     ┌─────────────┼─────────────┬──────────────┬────────────┐
     ▼             ▼             ▼              ▼            ▼
  /api/auth   /api/employees  /api/users   /api/roles   /api/mail
  /api/attendance  /api/health  /api-docs
                   │
                   ▼
            ┌──────────────┐
            │   MongoDB    │
            │  User        │  ← one collection for all people
            │  Role        │  ← permission matrix per role
            │  Attendance  │
            └──────────────┘
```

### Design decisions (current)

| Decision | Approach |
|----------|----------|
| Admin vs employee tables | **One `User` collection** — difference is `role` only |
| Auth for website | httpOnly cookie `token` + `CLIENT_URL` CORS |
| Auth for app / Swagger | `Authorization: Bearer <token>` (same JWT) |
| Employee Management UI | `GET /api/employees` → **role = Employee** only |
| Access & Control UI | `GET /api/users` → all roles with hierarchy |
| Create Super Admin | `POST /api/users/super-admin` → company required |
| Profile update | **One** `PUT /api/employees/:id` (section PUT removed) |
| Delete list rows | `DELETE /api/employees/:id/:section` |
| Permissions on login | Only **true** action flags; `permissionCount` = `"granted of max"` |

---

## Request flow

```text
Client
  │
  ├─ POST /api/auth/login
  │     → validate email/password
  │     → set cookie `token` + return token + user + compact permissions
  │
  ├─ Protected route
  │     → protect: read cookie OR Bearer → load Active user → req.user
  │     → authorize(roles…)
  │     → checkPermission(module, page, action)  [where used]
  │     → validate(Joi)
  │     → controller → MongoDB → JSON response
  │
  └─ POST /api/auth/logout → clear cookie
```

### Company scope

| Role | Company access |
|------|----------------|
| **Global Admin** | All companies (`official.company` = empty) |
| **Super Admin / HR Manager / Manager** | Own company only (`official.company`) |
| **Employee** | Own record only |

Helpers live in `src/utils/companyScope.js`.

### Create Super Admin — `POST /api/users/super-admin`

Lean account for one company. Prefer this over `POST /api/employees` with `role: Super Admin`.

| Actor | Can set `official.company` to |
|-------|-------------------------------|
| Global Admin | **Any** company (required) |
| Super Admin | **Own** company only |

```json
{
  "name": "Acme Super Admin",
  "password": "123456",
  "status": "Active",
  "official": {
    "officialEmail": "super@acme.com",
    "company": "Acme Private Limited"
  }
}
```

### User list visibility (`GET /api/users`)

| Viewer | Sees |
|--------|------|
| Global Admin | Everyone, every company |
| Super Admin | Own company, **except** Global Admin |
| HR Manager / Manager | Own company, **except** Global Admin + Super Admin |

---

## What is built (feature map)

| Area | Status | Notes |
|------|--------|--------|
| Auth login / logout | Done | Cookie + Bearer |
| Roles + permission matrix | Done | Catalog in `config/permissions.js` |
| Create user + welcome email | Done | Nested body = User model shape |
| Employee list | Done | Role Employee only |
| User list | Done | Hierarchy + company |
| Profile CRUD | Done | Nested sections; approval lock |
| Section row delete / clear payroll | Done | `DELETE /:id/:section` |
| File upload (Cloudinary) | Done | `POST /api/employees/upload` |
| Attendance punch + manual | Done | web / mobile / biometric / manual |
| Send email (Organization → Mail) | Done | `POST /api/mail/send` |
| Master dropdowns | Done | One `Master.js` — `type` → collection (`/api/masters?type=`) |
| Team chat (direct + group, files) | Done | `/api/chat` + Socket.IO on the same server |
| Swagger + Postman | Done | Keep in sync when APIs change |
| Rate limit + Helmet + Morgan | Done | Global + login limits |

---

## Tech stack

| Tool | Purpose |
|------|---------|
| Express | HTTP API |
| MongoDB + Mongoose | Data |
| JWT + cookie-parser | Sessions |
| bcryptjs | Password hashes |
| Joi | Body validation |
| Multer + Cloudinary | File upload |
| Nodemailer (Zoho) | Welcome + Mail send |
| Helmet / CORS / Morgan / rate-limit | Security & ops |
| Swagger / Postman | Docs & testing |

---

## Quick start

```bash
cd HRMS-Backend
npm install
# configure .env (see below)
npm run seed    # sample roles + users (clears users/roles)
npm run dev     # http://localhost:9001
```

### Seeded logins

| Role | Email | Password | Access |
|------|-------|----------|--------|
| Global Admin | `globaladmin@techculture.ai` | `123456` | All companies (seed-only; not in Roles UI) |
| Super Admin | `shivangi@techculture.ai` | `123456` | Own company (login + company only) |
| HR Manager | `hr@techculture.ai` | `123456` | Own company + employee profile |
| Manager | `manager@techculture.ai` | `123456` | Own company + employee profile |
| Employee | `shivig5964@gmail.com` | `123456` | Self + ESS profile |

Login ID = `official.officialEmail`.

**Global Admin / Super Admin** documents do **not** store employee profile fields (`personal`, `education`, `payroll`, …).  
**Super Admin** keeps `official.company` for company scope. **Global Admin** has no company (sees all).

---

## Roles

| Role | Scope | Notes |
|------|-------|--------|
| **Global Admin** | All companies | Platform owner. Visible in roles **only to Global Admin**. Only Global can create more (cap `MAX_GLOBAL_ADMINS`, default 5). Super Admin cannot escalate. |
| **Super Admin** | Own company | Full company admin |
| **HR Manager** | Own company | Permission matrix; can create users / reset password |
| **Manager** | Own company | Permission matrix |
| **Employee** | Self | ESS profile (no approval lock) |

**Admin roles** (ALL_ACCESS): Global Admin, Super Admin, HR Manager, Manager.  
Roles UI / dropdown uses `GET /api/roles` → Super Admin, HR Manager, Manager, Employee (+ custom).

---

## Auth

### Login

```http
POST /api/auth/login
{ "officialEmail": "…", "password": "…" }
```

Response:

- Sets httpOnly cookie **`token`**
- Also returns `token` (for mobile / Swagger / Postman)
- `user.permissionCount` → e.g. `"254 of 254"` = true flags / catalog max
- `user.permissions` → **only true** actions (false keys omitted)

### Calling protected APIs

| Client | How |
|--------|-----|
| Website | `credentials: "include"` (cookie); set `CLIENT_URL` |
| Mobile / Postman / Swagger | `Authorization: Bearer <token>` |

CORS does **not** apply to native mobile apps — only browsers.

### Logout

```http
POST /api/auth/logout
```

Clears the auth cookie.

---

## API map

```text
/
├── /api-docs
├── /api/health
├── /api/auth
│   ├── POST /login
│   └── POST /logout
├── /api/roles
│   ├── CRUD /
│   └── /:id/permissions
├── /api/employees          ← role = Employee (management table)
│   ├── POST   /
│   ├── GET    /
│   ├── GET    /:id
│   ├── PUT    /:id         ← sole update API
│   ├── DELETE /:id
│   ├── DELETE /:id/:section
│   └── POST   /upload
├── /api/users              ← all roles (Access & Control)
│     GET  /                ← list (hierarchy)
│     POST /super-admin     ← create Super Admin (company required)
│   └── GET    /
├── /api/mail
│   └── POST   /send
├── /api/masters            ← Master.js → type picks collection (departments, …)
│   ├── GET/POST /
│   └── GET/PUT/DELETE /:id
├── /api/attendance
│   ├── POST /punch-in | /punch-out | /manual
│   ├── GET  /today
│   └── GET  /
└── /api/chat               ← team chat (header X-Company-Id)
    ├── GET  /me | /employees | /conversations
    ├── POST /conversations | /conversations/:id/messages | /conversations/:id/read
    ├── GET  /conversations/:id/messages | /attachments/:attachmentId
    └── POST/PATCH/DELETE /groups …
```

---

## Masters (SaaS dropdowns)

**One model file** (`Master.js`) — `type` decides Mongo **collection name**.

ESS **General Info** has **9 modules** (no Vaccination). All dropdowns load from masters:

| Module | Dropdown fields → `type` |
|--------|---------------------------|
| Personal | `gender`, `maritalStatus`, `country`, `state`, `city` |
| Official | `company`, `department`, `designation`, `division`, `employeeGroup`, `grade`, `jobRole` |
| Other | `bloodGroup` |
| Education | `courseType`, `courseLevel` |
| Account | `bankName` |
| Family | `relation` |
| Nominee | `nominateFor`, `relation` (`nomineeName` = free text, not master) |
| Experience | `designation` |
| Visa | `country` (as `countryName`), `visaType` |

| `type` | Collection |
|--------|------------|
| `company` | `companies` |
| `department` | `departments` |
| `designation` | `designations` |
| `division` | `divisions` |
| `employeeGroup` | `employeegroups` |
| `grade` | `grades` |
| `jobRole` | `jobroles` |
| `gender` | `genders` |
| `maritalStatus` | `maritalstatuses` |
| `bloodGroup` | `bloodgroups` |
| `country` | `countries` |
| `state` | `states` |
| `city` | `cities` |
| `courseType` | `coursetypes` |
| `courseLevel` | `courselevels` |
| `bankName` | `banknames` |
| `relation` | `relations` |
| `nominateFor` | `nominatefors` |
| `visaType` | `visatypes` |

```http
GET /api/masters/meta
→ { types, generalInfoModules, dropdowns }

GET /api/masters?type=courseType&status=Active&search=Full&page=1&limit=50
→ { total, page, limit, pages, data, filters }

POST /api/masters
{ "type": "courseType", "name": "Full Time" }
```

List query: `type` (required), `status`, `company`, `search|q`, `page` (default 1), `limit` (default 50, max 200).

Employee pe **name** save karo (not `_id`).  
(Super Admin: company auto from login. Global Admin: send `company` in body.)

```http
GET /api/masters/meta
GET/POST /api/masters
GET/PUT/DELETE /api/masters/:id
```

---

## Employees vs Users

| Endpoint | Purpose |
|----------|---------|
| `GET /api/employees` | Employee Management — **only** `role: "Employee"` |
| `GET /api/users` | Access & Control — multiple roles (see visibility table above) |

Shared query params: `search`, `status`, `department`, `designation`, `gender`, `branch` (company), `page`, `limit`.  
`GET /api/users` also accepts `role` (within what the viewer may see).

---

## Create / update user

Create and update use the **same nested shape** as the `User` model (not flat fields).

### Create — `POST /api/employees`

**Required flat:** `name`, `password`, `role`, `status`  
**Required nested:** `official.officialEmail` (+ company/department by role — see below)

| Role created | Company | Department | Profile |
|--------------|---------|------------|---------|
| Super Admin | **required** (prefer `POST /api/users/super-admin`) | — | lean |
| HR / Manager / Employee | defaults to TechCulture.Ai Private Limited if omitted | required | full |

**Global Admin** is seed-only (one system account) — hidden from `GET /api/roles` and cannot be created or assigned via API.

Who: Global Admin, Super Admin, HR Manager, Manager (with Employee → create permission).  
Actor scope: Global Admin → any company; others → own company only.

After create → welcome email (if SMTP configured).

### Update — `PUT /api/employees/:id`

| Section | Who |
|---------|-----|
| `personal`, `other`, list arrays | Employee + Admin |
| `official`, `payroll` | Admin only |
| `role`, `status` | Admin only |
| `password` | Super Admin / HR Manager |

**Lists** (`education`, `accounts`, …):

- One object → append  
- One object with `_id` → update that row  
- Full array → replace list  

**Delete rows / clear payroll:** `DELETE /api/employees/:id/:section`  
(section = education | accounts | family | nominees | experience | visas | payroll). Official cannot be deleted.

### Unique when not empty

`official.officialEmail`, `official.employeeCode`, `personal.mobileNo`, `personal.personalEmail`, `personal.panNo`, `personal.aadhaarNo`, `personal.drivingLicenseNo`, `personal.passportNo`

### File upload

```http
POST /api/employees/upload
Form-data: document (file) + type (education | account)
```

Returns Cloudinary URL only — client puts it into the profile on Submit (`PUT`).

---

## Mail

```http
POST /api/mail/send
{
  "to": "user@company.com",
  "subject": "…",
  "body": "…",
  "cc": [],
  "bcc": [],
  "isHtml": false
}
```

Requires Organization → Mail → `email` (Global / Super Admin bypass). Uses same Zoho SMTP as welcome mail.

---

## Attendance

| Method | Path | Who |
|--------|------|-----|
| POST | `/punch-in`, `/punch-out` | Logged-in (`source`: web \| mobile \| biometric) |
| POST | `/manual` | Admin (missed punch; source stored as `manual`) |
| GET | `/today` | Self |
| GET | `/` | Admin = all (scoped); Employee = own |

---

## Team chat

REST under `/api/chat` (Bearer token + `X-Company-Id` = company from the header switcher) and
Socket.IO on the same server: `io(API_URL, { auth: { token, companyId } })`.

| Role | Can chat with | Groups |
|------|---------------|--------|
| Super Admin / Admin / HR | Everyone in the company (+ Super Admins / Admins) | Create |
| Reporting Manager | Own team | Create |
| Employee | Own Reporting Heads + company employees | Member only |

Supervisors can read chats where every member is in their contacts, but only members can send.

- **Socket events** — client emits `chat:join`, `chat:leave`, `message:send`, `chat:read` (with ack);
  server emits `message:new`, `inbox:update`, `chat:changed`.
- **Files** — up to 5 × 10 MB per message, stored as private (authenticated) raw files on
  Cloudinary under `hrms/chat/<companyId>`; served only through `GET /api/chat/attachments/:id`.
- **Collections** — `chatconversations`, `chatmessages`, `chatreads`.

---

## User document (profile modules)

One MongoDB document per person:

1. Account — name, password, role, status, lastLogin  
2. `personal` — IDs, phones, emails, addresses  
3. `official` — employeeCode, officialEmail, company, dept, designation, division, employeeGroup, joining  
4. `other` — blood group, passport expiry  
5. Arrays — education, accounts, family, nominees, experience, visas  
6. `payroll` — salary / PF / ESI (admin)

`personal.anniversaryDate` is derived from `official.dateOfJoining`.

---

## Folder structure

```text
HRMS-Backend/
├── postman/HRMS_API.postman_collection.json
├── src/
│   ├── config/          db, env, permissions catalog
│   ├── controllers/     auth, employee, role, attendance, mail, permission
│   ├── middleware/      auth, validate, upload
│   ├── models/          User, Role, Attendance, Master (dynamic collections by type)
│   ├── routes/          auth, employees, users, roles, attendance, mail, masters, health
│   ├── validators/      Joi schemas
│   ├── utils/           mail, authCookie, companyScope, uniqueFields, anniversary
│   ├── seed.js
│   ├── swagger.js
│   └── server.js
├── package.json
└── README.md
```

---

## Typical workflows

### A. Admin creates employee

1. Login as Global/Super Admin or HR  
2. `POST /api/employees` (nested body)  
3. Welcome email sent (async)  
4. Employee logs in with official email + password  

### B. Employee completes profile

1. Login as Employee  
2. Upload file → put URL in body  
3. `PUT /api/employees/:id` with personal / arrays  
4. Admins can always edit; activity log tracks who changed what  

### C. Access & Control vs Employee table

- UI **All Employees** → `GET /api/employees`  
- UI **Users / Access** → `GET /api/users`  

### D. Daily attendance

1. `POST /api/attendance/punch-in` `{ "source": "web" }`  
2. Later `punch-out`  
3. Missed → admin `POST /manual`  

---

## Environment variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `PORT` | No (9001) | Server port |
| `NODE_ENV` | No | development / production |
| `API_BASE_URL` | Prod | Public API URL (Swagger servers) |
| `MONGODB_URI` | Yes | Mongo connection |
| `JWT_SECRET` | Yes | Sign / verify JWT |
| `DEFAULT_COMPANY` | No | Default `official.company` on create (`TechCulture.Ai Private Limited`) |
| `CLIENT_URL` | Web cookies | Comma-separated frontend origins |
| `COOKIE_SECURE` | Cross-site | `true` → SameSite=None + Secure |
| `APP_URL` | No | Link in welcome email |
| `EMAIL_*` / `SMTP_*` | Mail | Zoho SMTP |
| `CLOUDINARY_*` | Uploads | File storage |
| `RATE_LIMIT_*` | No | Window / max / login max |

Example cookie CORS:

```env
CLIENT_URL=https://hrms-techculture.vercel.app,http://localhost:3000
COOKIE_SECURE=true
```

---

## Rate limiting

| Limit | Default | Window | Applies to |
|-------|---------|--------|------------|
| Global | 200 | 15 min | Almost all routes |
| Login | 20 | 15 min | `POST /api/auth/login` |

Over limit → **429**. Tunable via `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_LOGIN_MAX`.

---

## Testing

**Swagger:** login → copy `token` → Authorize → `Bearer <token>`  
**Postman:** import collection → Login → `{{token}}` / `{{userId}}` set automatically  

Folders in Postman: Health, Auth (incl. Logout), Roles, Employees, Users, Mail, Attendance.

---

## Common issues

| Problem | Fix |
|---------|-----|
| DB connect fail | Check `MONGODB_URI` |
| Please login first | Cookie missing or invalid Bearer |
| CORS on website | Add origin to `CLIENT_URL`; use `credentials: "include"` |
| Mobile CORS | N/A — use Bearer token |
| Unique field 400 | Email / mobile / PAN already used |
| PDF on Cloudinary | Enable PDF/ZIP delivery in Cloudinary security settings |
| 429 | Wait or raise `RATE_LIMIT_*` |

---

## Developer notes

- Keep **Swagger** (route `@swagger` + `src/swagger.js`) and **Postman** aligned when APIs change  
- Permission catalog source of truth: `src/config/permissions.js`  
- Partial unique indexes — empty strings do not block uniqueness  
- Joi `unknown(false)` rejects unexpected body keys  
- Change `JWT_SECRET`, SMTP, and Cloudinary before production  

---

## License / usage

Internal TechCulture HRMS backend. Not for public distribution without review.
