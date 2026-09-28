/**
 * HRMS API — main server entry (src/server.js)
 * Connect DB → middleware → rate limits → /api/* routes → listen
 * Local: http://localhost:PORT · Swagger /api-docs · Health /api/health
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const chalk = require("chalk");
const swaggerUi = require("swagger-ui-express");
const connectDB = require("./config/db");
const swaggerSpec = require("./swagger");

const authRoutes = require("./routes/auth.routes");
const roleRoutes = require("./routes/role.routes");
const employeeRoutes = require("./routes/employee.routes");
const accessControlRoutes = require("./routes/accessControl.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const shiftRoutes = require("./routes/shift.routes");
const timesheetRoutes = require("./routes/timesheet.routes");
const holidayRoutes = require("./routes/holiday.routes");
const workTimingRoutes = require("./routes/workTiming.routes");
const weeklyOffRoutes = require("./routes/weeklyOff.routes");
const mailRoutes = require("./routes/mail.routes");
const masterRoutes = require("./routes/master.routes");
const healthRoutes = require("./routes/health.routes");

const app = express();

/** Render / reverse proxy — needed for express-rate-limit + X-Forwarded-For */
app.set("trust proxy", 1);

// NO HTTP CACHE — API responses always fresh (avoid 304 Not Modified)

/** Disable ETag so APIs always return 200 + body (no 304 empty cache) */
app.disable("etag");
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// SECURITY & LOGGING MIDDLEWARE (order matters — runs top → bottom)

/** Helmet — secure headers (CSP off so Swagger UI works) */
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

/** CORS — allow all origins */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

/** Cookie parser — reads httpOnly JWT cookie named `token` */
app.use(cookieParser());

/** JSON body parser — max 1 MB so huge payloads are rejected early */
app.use(express.json({ limit: "1mb" }));

/** Morgan — colored request log (method, URL, status, ms) */
app.use(
  morgan((tokens, req, res) => {
    const status = Number(tokens.status(req, res));
    const statusColor =
      status >= 500
        ? chalk.red
        : status >= 400
          ? chalk.yellow
          : status >= 300
            ? chalk.cyan
            : chalk.green;
    return [
      chalk.gray(tokens.method(req, res)),
      chalk.white(tokens.url(req, res)),
      statusColor(status),
      chalk.magenta(`${tokens["response-time"](req, res)} ms`),
    ].join(" ");
  })
);

// RATE LIMIT — how many requests an IP may send

/** Rate limits — RATE_LIMIT_* in .env (global + stricter login) */
const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 min
const maxRequests = Number(process.env.RATE_LIMIT_MAX) || 200; // all APIs
const loginMax = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20; // login only

/** Global limiter — almost every request (health, employees, …) */
const globalLimiter = rateLimit({
  windowMs, // time window (ms)
  max: maxRequests, // max hits per IP in that window
  standardHeaders: true, // RateLimit-* headers (remaining count)
  legacyHeaders: false, // disable legacy X-RateLimit-* headers
  message: {
    message: "Too many requests from this IP. Please try again later.",
  },
});

/** Stricter limiter for POST /api/auth/login */
const loginLimiter = rateLimit({
  windowMs,
  max: loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again later.",
  },
});

// Apply global limit first (every route after this counts toward the max)
app.use(globalLimiter);

// DOCS / HOME / API ROUTE MOUNTS

/** Swagger UI at /api-docs */
const swaggerCss = fs.readFileSync(
  path.join(__dirname, "swagger", "custom.css"),
  "utf8"
);

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "HRMS API",
    customCss: swaggerCss,
  })
);

/** Root GET / — simple "API is working" status (no auth) */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    message: "HRMS API is working",
    name: "HRMS API",
    version: "1.0.0",
  });
});

/** Mount APIs under /api/* */
app.use("/api/health", healthRoutes); // public health check (API + MongoDB)
app.use("/api/auth/login", loginLimiter); // count login attempts (max 20 / window)
app.use("/api/auth", authRoutes); // login / logout
app.use("/api/roles", roleRoutes); // role CRUD + permission matrix
app.use("/api/permissions", require("./routes/permission.routes")); // catalogs + my permissions
app.use("/api/employees", employeeRoutes); // employees only (role = Employee)
app.use("/api/users", accessControlRoutes); // Access & Control (any role)
app.use("/api/attendance", attendanceRoutes); // punch in/out + geo + regularize
app.use("/api/shifts", shiftRoutes); // shift master + assignments
app.use("/api/timesheet", timesheetRoutes); // employee time sheet
app.use("/api/holidays", holidayRoutes); // Holiday Calendar
app.use("/api/work-timings", workTimingRoutes); // Work Timings
app.use("/api/weekly-offs", weeklyOffRoutes); // Weekly Off policies
app.use("/api/mail", mailRoutes); // Organization → Mail send
app.use("/api/masters", masterRoutes); // SaaS masters (typed collections)

// START SERVER (colored chalk banners)

const { PORT, API_BASE_URL, NODE_ENV } = require("./config/env");

connectDB().then(() => {
  app.listen(PORT, () => {
    const pad = (s, n = 72) => s.padEnd(n);
    console.log("");
    console.log(
      chalk.bgGreen.black.bold(pad(`  ✓  HRMS API is running (${NODE_ENV})`))
    );
    console.log(
      chalk.bgCyan.black(
        pad(`  →  API      ${API_BASE_URL}`)
      )
    );
    console.log(
      chalk.bgBlue.white(
        pad(`  →  Swagger  ${API_BASE_URL}/api-docs`)
      )
    );
    console.log(
      chalk.bgWhite.black(
        pad(`  →  Health   ${API_BASE_URL}/api/health`)
      )
    );
    console.log(
      chalk.bgMagenta.white(
        pad(
          `  →  Rate limit: ${maxRequests} req / ${Math.round(windowMs / 60000)} min (login: ${loginMax})`
        )
      )
    );
    console.log("");
  });
});
