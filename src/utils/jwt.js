/**
 * JWT helpers — sign / verify (call from login, protect, anywhere needed)
 */
const jwt = require("jsonwebtoken");

const JWT_SECRET = () => process.env.JWT_SECRET;
const JWT_EXPIRES_IN = () => process.env.JWT_EXPIRES_IN || "7d";

/**
 * Create a signed JWT for a user id.
 * Payload: { id }
 * Example: const token = signToken(user._id);
 */
const signToken = (userId) => {
  if (!JWT_SECRET()) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.sign({ id: String(userId) }, JWT_SECRET(), {
    expiresIn: JWT_EXPIRES_IN(),
  });
};

/** Alias — same as signToken */
const makeToken = signToken;

/**
 * Verify JWT and return decoded payload ({ id, iat, exp }).
 * Throws if invalid / expired.
 */
const verifyToken = (token) => {
  if (!JWT_SECRET()) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.verify(token, JWT_SECRET());
};

/** Decode without verifying (debug only — prefer verifyToken) */
const decodeToken = (token) => jwt.decode(token);

module.exports = {
  signToken,
  makeToken,
  verifyToken,
  decodeToken,
  JWT_EXPIRES_IN,
};
