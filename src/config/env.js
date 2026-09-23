/**
 * Environment switch for the public API base URL.
 *
 * NODE_ENV=development → http://localhost:PORT
 * NODE_ENV=production  → API_BASE_URL (Render)
 *
 * Render sets NODE_ENV=production automatically.
 * Local .env should set NODE_ENV=development.
 */
require("dotenv").config();

const onRender = process.env.RENDER === "true";
const NODE_ENV =
  process.env.NODE_ENV === "production" || onRender ? "production" : "development";
const isProduction = NODE_ENV === "production";
const PORT = process.env.PORT || 9001;

const DEV_API_URL = `http://localhost:${PORT}`;
const PROD_API_URL = (
  process.env.API_BASE_URL || "https://hrms-backend-py1t.onrender.com"
).replace(/\/$/, "");

const API_BASE_URL = isProduction ? PROD_API_URL : DEV_API_URL;

module.exports = {
  NODE_ENV,
  isProduction,
  PORT,
  DEV_API_URL,
  PROD_API_URL,
  API_BASE_URL,
};
