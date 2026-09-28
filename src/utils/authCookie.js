/**
 * AUTH COOKIE — JWT in httpOnly cookie `token` (Bearer fallback for Swagger/mobile)
 * Token create/verify → utils/jwt.js (signToken / verifyToken)
 */
const { isProduction } = require("../config/env");
const { JWT_EXPIRES_IN } = require("./jwt");

/** Cookie key used for the JWT */
const COOKIE_NAME = "token";

/** Parse JWT_EXPIRES_IN (7d/24h/…) into cookie maxAge ms */
const cookieMaxAgeMs = () => {
  const raw = String(JWT_EXPIRES_IN()).trim();
  const match = raw.match(/^(\d+)([dhms])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult =
    unit === "d"
      ? 24 * 60 * 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : unit === "m"
          ? 60 * 1000
          : 1000;
  return n * mult;
};

/** Shared cookie options for set / clear (SameSite/Secure) */
const cookieOptions = () => {
  const crossSite =
    isProduction || String(process.env.COOKIE_SECURE || "").toLowerCase() === "true";
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? "none" : "lax",
    maxAge: cookieMaxAgeMs(),
    path: "/",
  };
};

/** Write JWT into httpOnly token cookie after login */
const setAuthCookie = (res, token) => {
  res.cookie(COOKIE_NAME, token, cookieOptions());
};

/** Clear auth cookie on logout */
const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    ...cookieOptions(),
    maxAge: 0,
  });
};

/** Read JWT from cookie token, or Authorization Bearer */
const readToken = (req) => {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
};

module.exports = {
  COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  readToken,
};
