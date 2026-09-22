/**
 * HRMS API — main server entry point
 *
 * What this file does:
 *  1. Loads environment variables (.env)
 *  2. Connects to MongoDB
 *  3. Registers middleware (CORS, JSON body parser)
 *  4. Mounts all API route groups under /api/*
 *  5. Serves Swagger UI at /api-docs
 *  6. Listens on port 9001 (or PORT from .env)
 *
 * Run:
 *   npm run dev     — development (auto-restart)
 *   npm start       — production
 *   npm run seed    — seed roles + sample users
 *
 * URLs (default):
 *   API      → http://localhost:9001
 *   Swagger  → http://localhost:9001/api-docs
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const connectDB = require("./config/db");
const swaggerSpec = require("./swagger");

// ---------- Route modules ----------
const authRoutes = require("./routes/auth.routes");
const roleRoutes = require("./routes/role.routes");
const employeeRoutes = require("./routes/employee.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const permissionRoutes = require("./routes/permission.routes");

const app = express();

// ---------- Global middleware ----------
app.use(cors()); // allow frontend origins
app.use(express.json()); // parse JSON request bodies

// ---------- API documentation (Swagger UI) ----------
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------- Health / home ----------
app.get("/", (req, res) => {
  res.json({
    message: "HRMS API running",
    docs: "/api-docs",
    routes: ["auth", "roles", "permissions", "employees", "attendance"],
  });
});

// ---------- API routes ----------
app.use("/api/auth", authRoutes); // login, me
app.use("/api/roles", roleRoutes); // role CRUD + permissions
app.use("/api/permissions", permissionRoutes); // catalog + my permissions
app.use("/api/employees", employeeRoutes); // user/employee CRUD + education upload
app.use("/api/attendance", attendanceRoutes); // punch in/out + manual mark

// ---------- Start server (backend port 9001) ----------
const PORT = process.env.PORT || 9001;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`HRMS backend → http://localhost:${PORT}`);
    console.log(`Swagger docs → http://localhost:${PORT}/api-docs`);
  });
});
