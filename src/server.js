/**
 * HRMS API — main server entry point (src/server.js)
 *
 * STARTUP FLOW:
 *  1. Load .env
 *  2. Connect MongoDB
 *  3. Apply security middleware (helmet, cors, morgan, rate-limit)
 *  4. Mount routes under /api/*
 *  5. Serve Swagger at /api-docs
 *  6. Listen on PORT (default 9001)
 *
 * RUN:
 *   npm run dev   → nodemon (auto restart)
 *   npm start     → normal start
 *   npm run seed  → sample roles + users
 *
 * URLS:
 *   API      → http://localhost:9001
 *   Swagger  → http://localhost:9001/api-docs
 *   Health   → http://localhost:9001/api/health
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const chalk = require("chalk");
const swaggerUi = require("swagger-ui-express");
const connectDB = require("./config/db");
const swaggerSpec = require("./swagger");

// ---------- Route modules ----------
const authRoutes = require("./routes/auth.routes");
const roleRoutes = require("./routes/role.routes");
const employeeRoutes = require("./routes/employee.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const permissionRoutes = require("./routes/permission.routes");
const healthRoutes = require("./routes/health.routes");

const app = express();

// =============================================================================
// NO HTTP CACHE — API responses always fresh (avoid 304 Not Modified)
// =============================================================================
/**
 * Express by default sends ETag. Browser then sends If-None-Match → Express
 * replies 304 (body empty, “use cached”). For JSON APIs we always want 200 + body.
 */
app.disable("etag");
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// =============================================================================
// SECURITY & LOGGING MIDDLEWARE
// =============================================================================

/**
 * HELMET — secure HTTP response headers
 * Protects against common browser attacks (XSS, clickjacking, sniffing, …).
 * contentSecurityPolicy: false → needed so Swagger UI can load its scripts.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

/** CORS — allow frontend apps (web/mobile) to call this API from other origins */
app.use(cors());

/** JSON body parser — max 1 MB so huge payloads are rejected early */
app.use(express.json({ limit: "1mb" }));

/**
 * MORGAN — logs every HTTP request in the terminal (method, URL, status, time)
 * Status colors: green = ok | yellow = client error | red = server error
 */
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

// =============================================================================
// RATE LIMIT — “kitni baar call kar sakte ho”
// =============================================================================
/**
 * Rate limit = ek IP address se kitni requests allowed hain ek time window mein.
 *
 * WHY?
 *  - DDoS / flood se server overload na ho
 *  - Login pe password guess (brute-force) slow ho jaye
 *
 * DEFAULTS (change in .env):
 *  RATE_LIMIT_WINDOW_MS   = 900000  → 15 minutes (window size in milliseconds)
 *  RATE_LIMIT_MAX         = 200     → har IP max 200 API calls / 15 min (sab routes)
 *  RATE_LIMIT_LOGIN_MAX   = 20      → sirf /api/auth/login pe max 20 tries / 15 min
 *
 * EXAMPLE:
 *  - Aap 15 min mein 200 baar GET/POST etc. kar sakte ho (global)
 *  - Login separately: 15 min mein max 20 login attempts
 *  - Limit cross hone pe HTTP 429 + message "Too many requests…"
 *
 * COUNT: per client IP (express-rate-limit default). Same Wi‑Fi = often same IP.
 */
const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 min
const maxRequests = Number(process.env.RATE_LIMIT_MAX) || 200; // all APIs
const loginMax = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20; // login only

/** GLOBAL limiter — applies to almost every request (health, employees, …) */
const globalLimiter = rateLimit({
  windowMs, // time window (ms)
  max: maxRequests, // max hits per IP in that window
  standardHeaders: true, // RateLimit-* headers in response (remaining count)
  legacyHeaders: false, // disable old X-RateLimit-* headers
  message: {
    message: "Too many requests from this IP. Please try again later.",
  },
});

/**
 * LOGIN limiter — stricter, only on POST /api/auth/login
 * Stops someone from trying thousands of passwords quickly.
 */
const loginLimiter = rateLimit({
  windowMs,
  max: loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again later.",
  },
});

// Apply global limit first (every route after this counts toward 200)
app.use(globalLimiter);

// =============================================================================
// DOCS / HOME / ROUTES
// =============================================================================

/**
 * Swagger UI — interactive API docs (try endpoints in browser).
 * customCss restyles the guide above the endpoints (tables, headings, code chips).
 */
const swaggerCss = `
  .swagger-ui .topbar { display: none; }
  .swagger-ui .info { margin: 24px 0 8px; }
  .swagger-ui .info .title { color: #143028; font-size: 30px; }
  .swagger-ui .info .title small.version-stamp { background: #1f6b4a; }
  .swagger-ui .info .description {
    margin-top: 16px;
    padding: 4px 18px 12px;
    border: 1px solid #d7e3dc;
    border-radius: 12px;
    background: #fbfdfc;
  }
  .swagger-ui .info .description p {
    margin: 12px 0 8px;
    line-height: 1.5;
    color: #3d4f47;
  }
  .swagger-ui .info .description h3 {
    margin: 22px 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e3ebe6;
    color: #143028;
    font-size: 15px;
    font-weight: 700;
  }
  .swagger-ui .info table {
    margin: 0 0 6px;
    border: 1px solid #d7e3dc;
    border-radius: 8px;
    border-collapse: separate;
    border-spacing: 0;
    overflow: hidden;
  }
  .swagger-ui .info table thead tr th,
  .swagger-ui .info table thead tr td {
    background: #143028;
    color: #f4faf7;
    padding: 8px 12px;
    border-bottom: none;
    font-size: 12px;
  }
  .swagger-ui .info table tbody tr td {
    padding: 8px 12px;
    border-bottom: 1px solid #e7eeea;
    vertical-align: middle;
    min-width: 0;
  }
  .swagger-ui .info table tbody tr:last-child td { border-bottom: none; }
  .swagger-ui .info table tbody tr:nth-child(even) td { background: #f3f8f5; }
  .swagger-ui .info .markdown code,
  .swagger-ui .info .renderedMarkdown code {
    color: #0f5c42;
    background: #e7f3ed;
    font-weight: 600;
    font-size: 12.5px;
    padding: 1px 6px;
    border-radius: 5px;
  }
  .swagger-ui .scheme-container {
    margin: 12px 0 18px;
    padding: 12px 16px;
    background: #f7faf8;
    box-shadow: none;
    border: 1px solid #e4ebe7;
    border-radius: 10px;
  }
`;

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "HRMS API",
    customCss: swaggerCss,
  })
);

/** Root — quick pointer to docs + health + route names */
/** Root — simple status message (details via /api/health + /api-docs) */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    message: "HRMS API is working",
    name: "HRMS API",
    version: "1.0.0",
  });
});

/**
 * Mount APIs
 * Order matters for login: loginLimiter runs before auth routes on /api/auth/login
 */
app.use("/api/health", healthRoutes); // public health check (API + MongoDB)
app.use("/api/auth/login", loginLimiter); // count login attempts (max 20 / window)
app.use("/api/auth", authRoutes); // login, me
app.use("/api/roles", roleRoutes); // role CRUD + permission matrix
app.use("/api/permissions", permissionRoutes); // catalog + my permissions
app.use("/api/employees", employeeRoutes); // users / profile / education upload
app.use("/api/attendance", attendanceRoutes); // punch in/out + manual mark

// =============================================================================
// START SERVER (colored chalk banners)
// =============================================================================
const PORT = process.env.PORT || 9001;

connectDB().then(() => {
  app.listen(PORT, () => {
    const pad = (s, n = 56) => s.padEnd(n);
    console.log("");
    console.log(
      chalk.bgGreen.black.bold(pad("  ✓  HRMS API is running"))
    );
    console.log(
      chalk.bgCyan.black(
        pad(`  →  API      http://localhost:${PORT}`)
      )
    );
    console.log(
      chalk.bgBlue.white(
        pad(`  →  Swagger  http://localhost:${PORT}/api-docs`)
      )
    );
    console.log(
      chalk.bgWhite.black(
        pad(`  →  Health   http://localhost:${PORT}/api/health`)
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
