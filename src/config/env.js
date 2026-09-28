/**
 * ENV CONFIG — NODE_ENV, PORT, and public API base URL for Swagger / clients
 */
require("dotenv").config();

/** True when running on Render (forces production behaviour) */
const onRender = process.env.RENDER === "true";

/**
 * Effective environment name.
 * Treated as production if NODE_ENV=production or RENDER=true.
 */
const NODE_ENV =
  process.env.NODE_ENV === "production" || onRender ? "production" : "development";

/** Shortcut: true in production / on Render */
const isProduction = NODE_ENV === "production";

/** HTTP listen port (default 9001) */
const PORT = process.env.PORT || 9001;

/** Local API URL used in development */
const DEV_API_URL = `http://localhost:${PORT}`;

/** Deployed API URL (trailing slash stripped) */
const PROD_API_URL = (
  process.env.API_BASE_URL || "https://hrms-backend-py1t.onrender.com"
).replace(/\/$/, "");

/** Public base URL for this process (Swagger, links, CORS helpers) */
const API_BASE_URL = isProduction ? PROD_API_URL : DEV_API_URL;

module.exports = {
  NODE_ENV,
  isProduction,
  PORT,
  DEV_API_URL,
  PROD_API_URL,
  API_BASE_URL,
};
